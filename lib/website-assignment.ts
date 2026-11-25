import type { Prisma, PrismaClient } from "@prisma/client";
import { dhakaDateBound } from "./order-constants";
import { notify, type NotificationInput } from "./notifications";
import { getWebsiteUserId } from "./system-user";
import { normalizeWebOrderRules, WEBSITE_SETTINGS_KEY, type WebOrderRules } from "./storefront/settings-shape";
import type { WebsiteAssignReason } from "./website-order-constants";

// ROUND3 W-6 — which Sales Executive confirms a website order. Runs inside the
// transaction that writes the order (lib/storefront/place-order.ts), and in
// the website-orders job / an SE's check-in for orders nobody could be given.
// No session code here: the website's order endpoint imports this.
//
//  1. A repeat customer → the SE of their latest order, if that person is
//     still an active Sales Executive (checked in or not).
//  2. Otherwise round-robin among active SEs checked in today (an attendance
//     row for today's Dhaka date, checked in, not checked out): whoever got a
//     website order longest ago (never = first; ties by id).
//  3. Nobody checked in → the same round-robin among all active SEs, and
//     that SE's Team Leader (no Team Leader → the Managers) is told nobody
//     was in.
//  4. No active SE at all → unassigned: the order (and its lead) is held by
//     the inactive "Website (system)" user, because orders.sales_executive_id
//     is required. dealUnassignedWebsiteOrders() gives these out.
//
// The SE becomes the order's (and lead's) owner, so the ordinary scope rules
// show it in their list; they get a bell notification.

type Tx = Prisma.TransactionClient;
type Db = Prisma.TransactionClient | PrismaClient;

export type Assignment = { userId: number; teamId: number | null; reason: WebsiteAssignReason } | null;

export const ACTIVE_SE = { isActive: true, role: { name: "SalesExecutive" } } satisfies Prisma.UserWhereInput;

/** Limits and the targets switch, from the website_settings row (W-7's editor). */
export async function websiteOrderRules(db: Db): Promise<WebOrderRules> {
  const row = await db.setting.findUnique({ where: { key: WEBSITE_SETTINGS_KEY }, select: { value: true } });
  return normalizeWebOrderRules(row?.value ?? null);
}

/** Website drafts nobody could be given yet (held by the Website system user). */
export function unassignedWebsiteWhere(websiteUserId: number): Prisma.OrderWhereInput {
  return { source: "WEBSITE", status: "DRAFT", salesExecutiveId: websiteUserId };
}

/** Among the candidates: whose last website order came longest ago (never = first). Ties by id, so it's stable. */
async function nextInTurn(tx: Tx, candidates: { id: number; teamId: number | null }[]) {
  const last = await tx.order.groupBy({
    by: ["salesExecutiveId"],
    where: {
      source: "WEBSITE",
      salesExecutiveId: { in: candidates.map((c) => c.id) },
      webAssignedAt: { not: null },
      OR: [{ deletedAt: null }, { deletedAt: { not: null } }],
    },
    _max: { webAssignedAt: true },
  });
  const lastAt = new Map(last.map((l) => [l.salesExecutiveId, l._max.webAssignedAt?.getTime() ?? 0]));
  return [...candidates].sort((a, b) => (lastAt.get(a.id) ?? 0) - (lastAt.get(b.id) ?? 0) || a.id - b.id)[0];
}

/**
 * Who should get a website order now. Takes a lock so two orders at the same
 * moment never both go to the same "next" SE. `customerId`: an existing
 * customer (null for a new one); `excludeOrderId`: the order being dealt.
 */
export async function chooseSalesExecutive(
  tx: Tx,
  input: { customerId: number | null; excludeOrderId?: number },
  now = new Date()
): Promise<Assignment> {
  if (input.customerId != null) {
    const websiteUserId = await getWebsiteUserId(tx);
    const latest = await tx.order.findFirst({
      where: {
        customerId: input.customerId,
        salesExecutiveId: { not: websiteUserId },
        ...(input.excludeOrderId ? { id: { not: input.excludeOrderId } } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { salesExecutive: { select: { id: true, teamId: true, isActive: true, role: { select: { name: true } } } } },
    });
    const se = latest?.salesExecutive;
    if (se && se.isActive && se.role.name === ACTIVE_SE.role.name) {
      return { userId: se.id, teamId: se.teamId, reason: "OWN_CUSTOMER" };
    }
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('website-order-assign'))`;
  const onDuty = await tx.user.findMany({
    where: {
      ...ACTIVE_SE,
      attendance: { some: { date: dhakaDateBound(now), checkInAt: { not: null }, checkOutAt: null } },
    },
    select: { id: true, teamId: true },
  });
  if (onDuty.length > 0) {
    const se = await nextInTurn(tx, onDuty);
    return { userId: se.id, teamId: se.teamId, reason: "ON_DUTY" };
  }
  const everyone = await tx.user.findMany({ where: ACTIVE_SE, select: { id: true, teamId: true } });
  if (everyone.length === 0) return null;
  const se = await nextInTurn(tx, everyone);
  return { userId: se.id, teamId: se.teamId, reason: "NOBODY_IN" };
}

/** The SE's Team Leader; with none (or inactive), the team's active TLs; else the Managers. */
async function teamLeadersFor(tx: Tx, teamId: number | null): Promise<number[]> {
  if (teamId != null) {
    const team = await tx.team.findUnique({
      where: { id: teamId },
      select: { leader: { select: { id: true, isActive: true } } },
    });
    if (team?.leader?.isActive) return [team.leader.id];
    const leaders = await tx.user.findMany({
      where: { isActive: true, teamId, role: { name: "TeamLeader" } },
      select: { id: true },
    });
    if (leaders.length > 0) return leaders.map((l) => l.id);
  }
  const managers = await tx.user.findMany({ where: { isActive: true, role: { name: "Manager" } }, select: { id: true } });
  return managers.map((m) => m.id);
}

/** The bell for an assignment: the SE, and — when nobody was checked in — their Team Leader. */
export async function assignmentNotifications(
  tx: Tx,
  order: { id: number; ref: string; senderName: string },
  a: NonNullable<Assignment>,
  now = new Date()
): Promise<void> {
  const rows: NotificationInput[] = [
    {
      userId: a.userId,
      kind: "WEBSITE_ORDER",
      title: `New website order ${order.ref}`,
      body: `Message ${order.senderName} on WhatsApp to confirm it and take the advance.${a.reason === "OWN_CUSTOMER" ? " They are your customer." : ""}`,
      href: `/orders/${order.id}`,
      dedupeKey: `website-assign:${order.id}:${a.userId}:${now.getTime()}`,
    },
  ];
  if (a.reason === "NOBODY_IN") {
    for (const userId of await teamLeadersFor(tx, a.teamId)) {
      if (userId === a.userId) continue;
      rows.push({
        userId,
        kind: "WEBSITE_ORDER_NOBODY_IN",
        title: `Website order ${order.ref}: no Sales Executive was checked in`,
        body: "It went to a Sales Executive who isn't checked in — make sure someone messages the customer.",
        href: `/orders/${order.id}`,
        dedupeKey: `website-nobody-in:${order.id}:${userId}:${now.getTime()}`,
      });
    }
  }
  await notify(tx, rows);
}

/**
 * Hands an existing website order to the SE: order + lead owner and team,
 * when and why, and the bell. Used by the dealing job and by a manual
 * reassign; a new order is written with these fields directly.
 */
export async function giveOrderTo(
  tx: Tx,
  order: { id: number; ref: string; leadId: number | null; senderName: string },
  a: NonNullable<Assignment>,
  now = new Date()
): Promise<void> {
  await tx.order.update({
    where: { id: order.id },
    data: { salesExecutiveId: a.userId, teamId: a.teamId, webAssignedAt: now, webAssignReason: a.reason },
  });
  if (order.leadId != null) {
    await tx.lead.update({ where: { id: order.leadId }, data: { assignedTo: a.userId, teamId: a.teamId } });
  }
  await assignmentNotifications(tx, order, a, now);
}

/** The sender's name as typed (web_contact), for the bell. */
export function senderNameOf(webContact: unknown, fallback: string): string {
  const s = (webContact as { sender?: { name?: unknown } } | null)?.sender?.name;
  return typeof s === "string" && s.trim() ? s.trim() : fallback;
}

/** Runs fn in its own transaction — or straight in the caller's (the tests pass a rolled-back one). */
export async function inTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return "$transaction" in db ? db.$transaction(fn, { maxWait: 10_000, timeout: 20_000 }) : fn(db);
}

/**
 * Gives out every unassigned website draft (oldest first) by the same rules —
 * the website-orders job (every 15 minutes) and an SE's check-in. Each order
 * is its own short transaction, re-read under a row lock (someone may have
 * assigned it by hand meanwhile). Returns how many were given out.
 */
export async function dealUnassignedWebsiteOrders(db: Db, now = new Date()): Promise<number> {
  const websiteUserId = await getWebsiteUserId(db);
  const waiting = await db.order.findMany({
    where: unassignedWebsiteWhere(websiteUserId),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    select: { id: true },
  });
  let dealt = 0;
  for (const { id } of waiting) {
    const given = await inTx(db, async (tx) => {
      const [row] = await tx.$queryRaw<
        { sales_executive_id: number; status: string; source: string; deleted_at: Date | null; customer_id: number; lead_id: number | null; web_ref: string | null; customer_name: string; web_contact: unknown }[]
      >`
        SELECT o."sales_executive_id", o."status"::text AS "status", o."source"::text AS "source", o."deleted_at",
               o."customer_id", o."lead_id", o."web_ref", c."name" AS "customer_name", o."web_contact"
          FROM "orders" o JOIN "customers" c ON c."id" = o."customer_id"
         WHERE o."id" = ${id}
           FOR UPDATE OF o
      `;
      if (!row || row.sales_executive_id !== websiteUserId || row.status !== "DRAFT" || row.source !== "WEBSITE" || row.deleted_at) {
        return true;
      }
      const a = await chooseSalesExecutive(tx, { customerId: row.customer_id, excludeOrderId: id }, now);
      if (!a) return false;
      await giveOrderTo(
        tx,
        { id, ref: row.web_ref ?? `#${id}`, leadId: row.lead_id, senderName: senderNameOf(row.web_contact, row.customer_name) },
        a,
        now
      );
      dealt++;
      return true;
    });
    // No active SE at all: the rest wait too.
    if (!given) break;
  }
  return dealt;
}
