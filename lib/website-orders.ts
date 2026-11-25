import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { AuthzError } from "./authz";
import { logAuditTx } from "./audit";
import { applyStatusTransition } from "./orders";
import { getWebsiteUserId } from "./system-user";
import { storefrontOrigin } from "./storefront/hosts";
import { ACTIVE_SE, giveOrderTo, senderNameOf, unassignedWebsiteWhere } from "./website-assignment";
import {
  WEBSITE_ASSIGN_REASON_LABELS,
  WEBSITE_CANCEL_REASONS,
  WEBSITE_FLAG_LABELS,
  type WebContact,
  type WebsiteAssignReason,
  type WebsiteCancelReason,
} from "./website-order-constants";

// ROUND3 W-6 — website orders in the ERP: the Website panel on the order page
// (what the customer typed, who has it and why), Cancel with a reason, and a
// TL/Manager handing it to another SE. Confirming goes through the existing
// payment / status routes — confirmDraftTx gives the GV number (rule 6).

type Tx = Prisma.TransactionClient;
type Db = Prisma.TransactionClient | PrismaClient;

/** The viewer's own team and the teams they lead (a Team Leader assigns inside these). */
export async function viewerTeamIds(db: Db, userId: number): Promise<number[]> {
  const me = await db.user.findUnique({ where: { id: userId }, select: { teamId: true, leaderOf: { select: { id: true } } } });
  return [...(me?.teamId != null ? [me.teamId] : []), ...(me?.leaderOf.map((t) => t.id) ?? [])];
}

/** The SEs an assigner may pick: every active SE (orders.view_all), or those of their own teams. */
export async function assignableSalesExecutives(db: Db, viewer: { anyTeam: boolean; teamIds: number[] }) {
  if (!viewer.anyTeam && viewer.teamIds.length === 0) return [];
  return db.user.findMany({
    where: { ...ACTIVE_SE, ...(viewer.anyTeam ? {} : { teamId: { in: viewer.teamIds } }) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export type WebsiteOrderPanelData = {
  ref: string;
  /** The customer's private page (full address on the website's own domain). */
  link: string | null;
  placedAt: string;
  status: string;
  waiting: boolean;
  flags: string[];
  assignedTo: { id: number; name: string } | null;
  assignedAt: string | null;
  assignReason: string | null;
  contact: WebContact | null;
  saved: { name: string; country: string; phone: string };
  differs: { name: boolean; country: boolean };
  whatsappHref: string | null;
  cancelReason: string | null;
  canCancel: boolean;
  canAssign: boolean;
  sellers: { id: number; name: string }[];
};

export async function loadWebsiteOrderPanel(
  db: Db,
  orderId: number,
  viewer: { userId: number; permissions: string[] }
): Promise<WebsiteOrderPanelData | null> {
  const o = await db.order.findUnique({
    where: { id: orderId },
    select: {
      source: true,
      webRef: true,
      webToken: true,
      webContact: true,
      webFlags: true,
      webAssignedAt: true,
      webAssignReason: true,
      status: true,
      cancelReason: true,
      createdAt: true,
      salesExecutiveId: true,
      salesExecutive: { select: { id: true, name: true } },
      customer: { select: { name: true, country: true, phoneForeign: true } },
    },
  });
  if (!o || o.source !== "WEBSITE") return null;
  const websiteUserId = await getWebsiteUserId(db);
  const waiting = o.status === "DRAFT";
  const contact = (o.webContact ?? null) as WebContact | null;
  const unassigned = o.salesExecutiveId === websiteUserId;
  const canAssign = waiting && viewer.permissions.includes("orders.assign");
  const anyTeam = viewer.permissions.includes("orders.view_all");
  const sellers = canAssign
    ? await assignableSalesExecutives(db, { anyTeam, teamIds: anyTeam ? [] : await viewerTeamIds(db, viewer.userId) })
    : [];
  const name = contact?.sender.name ?? o.customer.name;
  const digits = (contact?.sender.whatsapp ?? o.customer.phoneForeign).replace(/\D/g, "");
  const ref = o.webRef ?? "";
  const greeting = `Hi ${name}, this is Gift Valy about your website order ${ref}.`;
  return {
    ref,
    link: o.webToken ? `${storefrontOrigin()}/order/${o.webToken}` : null,
    placedAt: o.createdAt.toISOString(),
    status: o.status,
    waiting,
    flags: o.webFlags.map((f) => WEBSITE_FLAG_LABELS[f] ?? f),
    assignedTo: unassigned ? null : { id: o.salesExecutive.id, name: o.salesExecutive.name },
    assignedAt: o.webAssignedAt?.toISOString() ?? null,
    assignReason: o.webAssignReason ? (WEBSITE_ASSIGN_REASON_LABELS[o.webAssignReason as WebsiteAssignReason] ?? o.webAssignReason) : null,
    contact,
    saved: { name: o.customer.name, country: o.customer.country, phone: o.customer.phoneForeign },
    differs: {
      name: !!contact && contact.sender.name.trim().toLowerCase() !== o.customer.name.trim().toLowerCase(),
      country: !!contact && contact.sender.country !== o.customer.country,
    },
    whatsappHref: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(greeting)}` : null,
    cancelReason: o.cancelReason,
    canCancel: waiting && (viewer.permissions.includes("orders.cancel") || o.salesExecutiveId === viewer.userId),
    canAssign,
    sellers,
  };
}

/**
 * Cancel a website order still waiting for confirmation, with one of the
 * reasons. DRAFT → CANCELLED through the one status transition (history +
 * stock hook — nothing is reserved on a draft); its lead → LOST with the
 * matching reason. It never had a GV number, so order_sequences is untouched.
 * Who: anyone with orders.cancel in scope, or the SE it is assigned to.
 */
export async function cancelWebsiteOrder(
  tx: Tx,
  input: { orderId: number; reason: WebsiteCancelReason; userId: number }
): Promise<{ ref: string }> {
  // Verify R3 — wait for a confirmation in flight, then read its outcome
  // (never cancel an order that just got its GV number).
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${input.orderId} FOR UPDATE`;
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: { status: true, source: true, deletedAt: true, cancelReason: true, leadId: true, webRef: true },
  });
  if (!order || order.deletedAt || order.source !== "WEBSITE") throw new AuthzError(404, "Order not found");
  if (order.status !== "DRAFT") {
    throw new AuthzError(409, "Only a website order still waiting for confirmation can be cancelled here.");
  }
  const reason = WEBSITE_CANCEL_REASONS.find((r) => r.value === input.reason);
  if (!reason) throw new AuthzError(400, "Choose why the order is cancelled.");
  const note = `Website order cancelled: ${reason.label}`;
  await applyStatusTransition(tx, { id: input.orderId, status: "DRAFT", cancelReason: order.cancelReason }, "CANCELLED", input.userId, note);
  if (order.leadId != null) {
    await tx.lead.update({
      where: { id: order.leadId },
      data: { status: "LOST", lostReason: reason.lostReason, updatedBy: input.userId },
    });
  }
  await logAuditTx(tx, {
    userId: input.userId,
    action: "order.cancel.website",
    entity: "orders",
    entityId: input.orderId,
    before: { status: "DRAFT" },
    after: { status: "CANCELLED", reason: reason.value, ref: order.webRef },
  });
  return { ref: order.webRef ?? "" };
}

/**
 * A TL/Manager hands a website order (still a draft) to an SE. With
 * orders.view_all: any order, any active SE. A Team Leader: unassigned orders
 * or their own teams', to an SE of their own teams. Audited; the SE gets a bell.
 */
export async function assignWebsiteOrder(
  tx: Tx,
  actor: { userId: number; anyTeam: boolean; teamIds: number[] },
  input: { orderId: number; seId: number },
  now = new Date()
): Promise<void> {
  const websiteUserId = await getWebsiteUserId(tx);
  const [row] = await tx.$queryRaw<
    { sales_executive_id: number; team_id: number | null; status: string; source: string; deleted_at: Date | null; lead_id: number | null; web_ref: string | null; web_contact: unknown; customer_name: string }[]
  >`
    SELECT o."sales_executive_id", o."team_id", o."status"::text AS "status", o."source"::text AS "source", o."deleted_at",
           o."lead_id", o."web_ref", o."web_contact", c."name" AS "customer_name"
      FROM "orders" o JOIN "customers" c ON c."id" = o."customer_id"
     WHERE o."id" = ${input.orderId}
       FOR UPDATE OF o
  `;
  if (!row || row.deleted_at || row.source !== "WEBSITE") throw new AuthzError(404, "Order not found");
  const unassigned = row.sales_executive_id === websiteUserId;
  if (!actor.anyTeam && !unassigned && (row.team_id == null || !actor.teamIds.includes(row.team_id))) {
    throw new AuthzError(404, "Order not found");
  }
  if (row.status !== "DRAFT") throw new AuthzError(409, "Only a website order still waiting for confirmation can be reassigned.");
  const se = await tx.user.findFirst({ where: { id: input.seId, ...ACTIVE_SE }, select: { id: true, teamId: true, name: true } });
  if (!se) throw new AuthzError(400, "Pick an active Sales Executive.");
  if (!actor.anyTeam && (se.teamId == null || !actor.teamIds.includes(se.teamId))) {
    throw new AuthzError(403, "Pick a Sales Executive from your own team.");
  }
  if (row.sales_executive_id === se.id) return;
  await giveOrderTo(
    tx,
    { id: input.orderId, ref: row.web_ref ?? `#${input.orderId}`, leadId: row.lead_id, senderName: senderNameOf(row.web_contact, row.customer_name) },
    { userId: se.id, teamId: se.teamId, reason: "MANUAL" },
    now
  );
  await logAuditTx(tx, {
    userId: actor.userId,
    action: "order.assign",
    entity: "orders",
    entityId: input.orderId,
    before: { assignedTo: unassigned ? null : row.sales_executive_id },
    after: { assignedTo: se.id, assignedToName: se.name },
  });
}

export type UnassignedWebsiteOrder = { id: number; ref: string; placedAt: string; total: number; customer: string | null };

/**
 * Website drafts nobody could be given (no active SE at the time). They
 * belong to no team, so a Team Leader sees them all to hand them out — the
 * customer's name only for those who see every order.
 */
export async function listUnassignedWebsiteOrders(db: Db, opts: { withCustomer: boolean }): Promise<UnassignedWebsiteOrder[]> {
  const websiteUserId = await getWebsiteUserId(db);
  const rows = await db.order.findMany({
    where: unassignedWebsiteWhere(websiteUserId),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
    select: { id: true, webRef: true, createdAt: true, totalAmount: true, customer: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    ref: r.webRef ?? `#${r.id}`,
    placedAt: r.createdAt.toISOString(),
    total: Number(r.totalAmount),
    customer: opts.withCustomer ? r.customer.name : null,
  }));
}

/** Website orders waiting for confirmation, in this scope (the dashboard card, the tab count). */
export async function websiteWaitingCount(scope: Prisma.OrderWhereInput, db: Db = prisma): Promise<number> {
  return db.order.count({ where: { AND: [scope, { source: "WEBSITE", status: "DRAFT" }] } });
}
