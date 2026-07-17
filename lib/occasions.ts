import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { dbDate, normalizePhone } from "./order-constants";
import {
  daysBetweenYmd,
  nextOccurrenceYmd,
  occasionPeriodRange,
  occasionToday,
  type OccasionRow,
  type OccasionType,
} from "./occasion-constants";

export type { OccasionRow };

type Tx = Prisma.TransactionClient | PrismaClient;

// CORRECTIONS Orders §7 (form part) — persist the recipient's Birthday /
// Anniversary against the customer↔recipient profile (keyed by the recipient's
// BD phone), not just the order. Blank dates never clobber values that were
// saved earlier: the SE may skip them on a repeat order without wiping the
// profile. A row is only created when at least one date is provided; the
// name/relation refresh whenever a row already exists.
export async function upsertRecipientOccasions(
  db: Tx,
  input: {
    customerId: number;
    recipientName: string;
    recipientPhoneBd: string;
    relation: string | null;
    birthday: string | null | undefined; // YYYY-MM-DD
    anniversary: string | null | undefined; // YYYY-MM-DD
    userId: number;
  }
): Promise<void> {
  const phone = normalizePhone(input.recipientPhoneBd);
  if (!phone) return;

  const dates = {
    ...(input.birthday ? { birthday: dbDate(input.birthday) } : {}),
    ...(input.anniversary ? { anniversary: dbDate(input.anniversary) } : {}),
  };

  const existing = await db.customerOccasion.findUnique({
    where: {
      customerId_recipientPhoneBd: {
        customerId: input.customerId,
        recipientPhoneBd: phone,
      },
    },
    select: { id: true },
  });

  if (existing) {
    await db.customerOccasion.update({
      where: { id: existing.id },
      data: {
        recipientName: input.recipientName,
        relation: input.relation,
        ...dates,
        updatedBy: input.userId,
      },
    });
  } else if (input.birthday || input.anniversary) {
    await db.customerOccasion.create({
      data: {
        customerId: input.customerId,
        recipientName: input.recipientName,
        recipientPhoneBd: phone,
        relation: input.relation,
        ...dates,
        createdBy: input.userId,
        updatedBy: input.userId,
      },
    });
  }
}

// Profile lookup for form prefill (edit page) — returns YYYY-MM-DD strings.
export async function findRecipientOccasions(
  db: Tx,
  customerId: number,
  recipientPhoneBd: string
): Promise<{ birthday: string | null; anniversary: string | null }> {
  const phone = normalizePhone(recipientPhoneBd);
  const row = phone
    ? await db.customerOccasion.findUnique({
        where: {
          customerId_recipientPhoneBd: {
            customerId,
            recipientPhoneBd: phone,
          },
        },
        select: { birthday: true, anniversary: true },
      })
    : null;
  return {
    birthday: row?.birthday ? row.birthday.toISOString().slice(0, 10) : null,
    anniversary: row?.anniversary
      ? row.anniversary.toISOString().slice(0, 10)
      : null,
  };
}

// ---------- C8: Occasions menu + reminders (repeat-sale engine) ----------

// A `@db.Date` value is stored at UTC-midnight, so its UTC month/day ARE the
// calendar occasion (no timezone shift). Extract them for recurrence math.
function monthDayOf(d: Date): { month: number; day: number } {
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// Every occasion (birthday + anniversary, each a separate row) whose NEXT annual
// occurrence lands inside [from, to] (inclusive, Dhaka YYYY-MM-DD). `scope`
// limits which customers' occasions are visible (undefined = all). Rows are
// sorted soonest-first, then by customer name. Reused by the Occasions page and
// the SE reminder widget (which passes a today→today+lead window).
export async function buildOccasionWindow(opts: {
  from: string;
  to: string;
  scope?: Prisma.CustomerWhereInput;
  today?: string;
}): Promise<OccasionRow[]> {
  const today = opts.today ?? occasionToday();
  const { from, to } = opts;
  if (!from || !to || from > to) return [];

  const profiles = await prisma.customerOccasion.findMany({
    where: {
      OR: [{ birthday: { not: null } }, { anniversary: { not: null } }],
      ...(opts.scope ? { customer: opts.scope } : {}),
    },
    include: {
      customer: {
        select: { id: true, name: true, phoneForeign: true, country: true },
      },
    },
  });

  if (profiles.length === 0) return [];

  // Most-recent order per customer (for the "last order" column). One query,
  // newest-first, then keep the first seen per customer. totalAmount is
  // customer-facing (no cost) so it's safe for every role.
  const customerIds = [...new Set(profiles.map((p) => p.customerId))];
  const orders = await prisma.order.findMany({
    where: { customerId: { in: customerIds } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      orderNo: true,
      customerId: true,
      createdAt: true,
      totalAmount: true,
    },
  });
  const lastOrderByCustomer = new Map<number, OccasionRow["lastOrder"]>();
  for (const o of orders) {
    if (lastOrderByCustomer.has(o.customerId)) continue;
    lastOrderByCustomer.set(o.customerId, {
      id: o.id,
      orderNo: o.orderNo,
      date: o.createdAt.toISOString().slice(0, 10),
      total: Number(o.totalAmount),
    });
  }

  const rows: OccasionRow[] = [];
  const push = (
    p: (typeof profiles)[number],
    type: OccasionType,
    d: Date
  ) => {
    const { month, day } = monthDayOf(d);
    const nextOccurrence = nextOccurrenceYmd(month, day, today);
    if (nextOccurrence < from || nextOccurrence > to) return;
    rows.push({
      occasionId: p.id,
      type,
      customerId: p.customerId,
      customerName: p.customer.name,
      customerPhone: p.customer.phoneForeign,
      country: p.customer.country,
      recipientName: p.recipientName,
      recipientPhoneBd: p.recipientPhoneBd,
      relation: p.relation,
      date: d.toISOString().slice(0, 10),
      nextOccurrence,
      daysRemaining: daysBetweenYmd(today, nextOccurrence),
      lastOrder: lastOrderByCustomer.get(p.customerId) ?? null,
    });
  };

  for (const p of profiles) {
    if (p.birthday) push(p, "Birthday", p.birthday);
    if (p.anniversary) push(p, "Anniversary", p.anniversary);
  }

  rows.sort(
    (a, b) =>
      a.daysRemaining - b.daysRemaining ||
      a.customerName.localeCompare(b.customerName)
  );
  return rows;
}

// The reminder feed for the SE follow-up area: occasions whose next occurrence
// is within `leadDays` from today (inclusive of today). Thin wrapper over the
// window builder so the list and the reminders share one code path.
export async function buildOccasionReminders(opts: {
  leadDays: number;
  scope?: Prisma.CustomerWhereInput;
}): Promise<OccasionRow[]> {
  const today = occasionToday();
  const { from } = occasionPeriodRange("today");
  // today + leadDays, computed via the recurrence helper's calendar math.
  const to = nextOccurrenceWindowEnd(today, opts.leadDays);
  return buildOccasionWindow({ from, to, scope: opts.scope, today });
}

// today shifted forward by `leadDays` (YYYY-MM-DD, Dhaka calendar).
function nextOccurrenceWindowEnd(todayYmd: string, leadDays: number): string {
  const [y, m, d] = todayYmd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + Math.max(0, leadDays), 12))
    .toISOString()
    .slice(0, 10);
}

// CORRECTIONS Orders §7 — edit an existing occasion profile from the customer
// profile / Occasions page. Unlike upsertRecipientOccasions (which never
// clears), this applies birthday/anniversary EXACTLY as given: null clears the
// date. recipientName/relation update when provided.
export async function updateOccasion(
  db: Tx,
  id: number,
  input: {
    recipientName?: string;
    relation?: string | null;
    birthday: string | null;
    anniversary: string | null;
    userId: number;
  }
): Promise<void> {
  await db.customerOccasion.update({
    where: { id },
    data: {
      ...(input.recipientName !== undefined
        ? { recipientName: input.recipientName }
        : {}),
      ...(input.relation !== undefined ? { relation: input.relation } : {}),
      birthday: input.birthday ? dbDate(input.birthday) : null,
      anniversary: input.anniversary ? dbDate(input.anniversary) : null,
      updatedBy: input.userId,
    },
  });
}
