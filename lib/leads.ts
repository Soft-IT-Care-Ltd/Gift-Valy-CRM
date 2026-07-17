import type { Prisma, PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { z } from "zod";
import { prisma } from "./db";
import { AuthzError } from "./authz";
import { dhakaDayStart } from "./orders";
import { dbDate, normalizePhone } from "./order-constants";
import { AD_COST_CATEGORY } from "./expense-constants";
import { presetRange } from "./date-filter";
import {
  LEAD_PAGE_SIZES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LOST_REASONS,
  MANUAL_LEAD_STATUSES,
  OPEN_LEAD_STATUSES,
  timeSince,
  type InterestedItem,
  type LeadRow,
  type LeadSourceValue,
  type LeadStatusValue,
} from "./lead-constants";

type Tx = Prisma.TransactionClient | PrismaClient;

// ---------- scope (SPEC §2.2 / §3.2: SE own / TL team / Manager+Admin all) ----------

export type LeadScope = "all" | "team" | "own";

export function leadViewScope(permissions: string[]): LeadScope | null {
  if (permissions.includes("leads.view_all")) return "all";
  if (permissions.includes("leads.view_team")) return "team";
  if (permissions.includes("leads.view_own")) return "own";
  return null;
}

// Prisma where clause limiting leads to what this user may see (mirrors
// orderScopeWhere): TL sees own + their team's, Manager/Admin see all.
export async function leadScopeWhere(
  session: Session,
  permissions: string[]
): Promise<Prisma.LeadWhereInput> {
  const scope = leadViewScope(permissions);
  if (!scope) throw new AuthzError(403, "No lead view permission");
  if (scope === "all") return {};
  if (scope === "own") return { assignedTo: session.user.id };
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { teamId: true, leaderOf: { select: { id: true } } },
  });
  const teamIds = [
    ...(user?.teamId ? [user.teamId] : []),
    ...(user?.leaderOf.map((t) => t.id) ?? []),
  ];
  return {
    OR: [{ assignedTo: session.user.id }, { teamId: { in: teamIds } }],
  };
}

// Scope for lead_daily_counts (rows carry only a userId, no team). Resolves the
// team scope to the concrete member-id set so the R2 report can fold bulk counts
// into the same view as detailed leads.
export async function dailyCountScopeWhere(
  session: Session,
  permissions: string[]
): Promise<Prisma.LeadDailyCountWhereInput> {
  const scope = leadViewScope(permissions);
  if (!scope) throw new AuthzError(403, "No lead view permission");
  if (scope === "all") return {};
  if (scope === "own") return { userId: session.user.id };
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { teamId: true, leaderOf: { select: { id: true } } },
  });
  const teamIds = [
    ...(user?.teamId ? [user.teamId] : []),
    ...(user?.leaderOf.map((t) => t.id) ?? []),
  ];
  const members = await prisma.user.findMany({
    where: { teamId: { in: teamIds } },
    select: { id: true },
  });
  const ids = new Set<number>([session.user.id, ...members.map((m) => m.id)]);
  return { userId: { in: [...ids] } };
}

// Reassign targets / assign-on-entry / SE-filter options for the caller's scope:
// own → just me; team → me + my team(s); all → every active seller role.
export async function getAssignableUsers(
  session: Session,
  permissions: string[]
): Promise<{ id: number; name: string }[]> {
  const scope = leadViewScope(permissions);
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { id: true, teamId: true, leaderOf: { select: { id: true } } },
  });
  let where: Prisma.UserWhereInput;
  if (scope === "all") {
    // Always include the caller: an Admin isn't a seller role but must be able
    // to assign to themself, appear in the SE filter and in reassign targets.
    where = {
      isActive: true,
      OR: [
        { id: me.id },
        { role: { name: { in: ["SalesExecutive", "TeamLeader", "Manager"] } } },
      ],
    };
  } else if (scope === "team") {
    const teamIds = [
      ...(me.teamId ? [me.teamId] : []),
      ...me.leaderOf.map((t) => t.id),
    ];
    where = { isActive: true, OR: [{ id: me.id }, { teamId: { in: teamIds } }] };
  } else {
    where = { id: me.id };
  }
  return prisma.user.findMany({
    where,
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

// Options both entry forms and the edit dialog need: the sellable catalog for
// "interested in" (component-only packing materials excluded, CORRECTIONS
// Products §1) and known campaign names for autocomplete.
export async function getLeadFormOptions(scope: Prisma.LeadWhereInput): Promise<{
  catalog: { itemType: "PRODUCT" | "PACKAGE"; id: number; name: string }[];
  campaigns: string[];
}> {
  const [products, packages, adCampaigns, leadCampaigns] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true, productType: "SELLABLE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.package.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.expense.findMany({
      where: { category: { name: AD_COST_CATEGORY }, campaignName: { not: null } },
      select: { campaignName: true },
      distinct: ["campaignName"],
      take: 100,
    }),
    prisma.lead.findMany({
      where: { AND: [scope, { campaignName: { not: null } }] },
      select: { campaignName: true },
      distinct: ["campaignName"],
      take: 100,
    }),
  ]);
  const catalog = [
    ...packages.map((p) => ({ itemType: "PACKAGE" as const, id: p.id, name: p.name })),
    ...products.map((p) => ({ itemType: "PRODUCT" as const, id: p.id, name: p.name })),
  ];
  const campaigns = [
    ...new Set(
      [...adCampaigns, ...leadCampaigns]
        .map((c) => c.campaignName?.trim())
        .filter((c): c is string => !!c)
    ),
  ].sort((a, b) => a.localeCompare(b));
  return { catalog, campaigns };
}

// ---------- list filters & pagination (CORRECTIONS Leads §4) ----------

export interface LeadListQuery {
  filters: Prisma.LeadWhereInput[]; // scope + search + selects + date window
  // Same window/source/SE on lead_daily_counts — the bulk half of the §6
  // combined total shown next to the list count.
  bulkFilters: Prisma.LeadDailyCountWhereInput[];
  page: number;
  size: number;
  q: string;
  rangeAll: boolean;
}

// URL params → Prisma filters, mirroring buildOrderListFilters: the window
// defaults to the current Dhaka month (the old all-time default loaded far too
// much) unless explicit dates, ?range=all, or a search — search spans all time.
export function buildLeadListFilters(
  params: Record<string, string | undefined>,
  scope: Prisma.LeadWhereInput
): LeadListQuery {
  const q = (params.q ?? "").trim();
  const rangeAll = params.range === "all";

  const filters: Prisma.LeadWhereInput[] = [scope];
  const bulkFilters: Prisma.LeadDailyCountWhereInput[] = [];

  if (q) {
    const digits = q.replace(/\D/g, "");
    const or: Prisma.LeadWhereInput[] = [
      { customerName: { contains: q, mode: "insensitive" } },
      { campaignName: { contains: q, mode: "insensitive" } },
    ];
    if (digits.length >= 3) or.push({ whatsappNumber: { contains: digits } });
    filters.push({ OR: or });
  }
  if (
    params.status &&
    LEAD_STATUSES.includes(params.status as LeadStatusValue)
  ) {
    filters.push({ status: params.status as LeadStatusValue });
  }
  if (
    params.source &&
    LEAD_SOURCES.includes(params.source as LeadSourceValue)
  ) {
    filters.push({ source: params.source as LeadSourceValue });
    bulkFilters.push({ source: params.source as LeadSourceValue });
  }
  const seId = Number(params.seId);
  if (seId) {
    filters.push({ assignedTo: seId });
    bulkFilters.push({ userId: seId });
  }

  // leadDate / date are @db.Date — bound with UTC-midnight dates (dbDate), not
  // +06:00 instants Prisma would truncate to the previous UTC day.
  const hasFrom = !!params.from && DATE_RE.test(params.from);
  const hasTo = !!params.to && DATE_RE.test(params.to);
  if (hasFrom) {
    filters.push({ leadDate: { gte: dbDate(params.from!) } });
    bulkFilters.push({ date: { gte: dbDate(params.from!) } });
  }
  if (hasTo) {
    filters.push({ leadDate: { lte: dbDate(params.to!) } });
    bulkFilters.push({ date: { lte: dbDate(params.to!) } });
  }
  if (!hasFrom && !hasTo && !rangeAll && !q) {
    const monthFrom = dbDate(presetRange("month").from);
    filters.push({ leadDate: { gte: monthFrom } });
    bulkFilters.push({ date: { gte: monthFrom } });
  }

  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  const sizeParam = Number(params.size);
  const size = (LEAD_PAGE_SIZES as readonly number[]).includes(sizeParam)
    ? sizeParam
    : LEAD_PAGE_SIZES[0];
  return { filters, bulkFilters, page, size, q, rangeAll };
}

// A user may edit a lead if they hold leads.edit (any lead they can already see)
// or they are its assignee — SEs manage their own leads' status/follow-up as part
// of lead entry (SPEC §17 SOP), even though the seed matrix omits leads.edit.
export function canEditLead(
  lead: { assignedTo: number },
  session: Session,
  permissions: string[]
): boolean {
  return permissions.includes("leads.edit") || lead.assignedTo === session.user.id;
}

// ---------- payload validation ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const interestedSchema = z
  .array(
    z.object({
      itemType: z.enum(["PRODUCT", "PACKAGE"]),
      id: z.number().int().positive(),
    })
  )
  .optional()
  .default([]);

const nullableTrimmed = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : null));

// Fields an SE fills on entry AND may later edit (§3.1). assignedTo is NOT here —
// (re)assignment is its own permissioned action (§3.2).
export const leadCoreSchema = z.object({
  leadDate: z.string().regex(DATE_RE, "Pick a valid date"),
  source: z.enum(LEAD_SOURCES),
  campaignName: nullableTrimmed,
  customerName: nullableTrimmed,
  country: nullableTrimmed,
  whatsappNumber: z.string().trim().min(6, "WhatsApp number is required"),
  interestedIn: interestedSchema,
  // CONVERTED is system-only (§3.2) — the form offers manual statuses only.
  status: z.enum(MANUAL_LEAD_STATUSES as [string, ...string[]]),
  followUpAt: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  lostReason: z
    .enum(LOST_REASONS)
    .nullable()
    .optional(),
  notes: nullableTrimmed,
});

export const createLeadSchema = leadCoreSchema.extend({
  // Defaults to the creator; only leads.reassign may hand a new lead to someone
  // else on creation (checked in the route).
  assignedTo: z.number().int().positive().nullable().optional(),
});

export const reassignLeadSchema = z.object({
  assignedTo: z.number().int().positive(),
});

// SPEC §3.1 bulk quick-entry — a per-source (optionally per-campaign) daily count.
export const dailyCountSchema = z.object({
  date: z.string().regex(DATE_RE, "Pick a valid date"),
  source: z.enum(LEAD_SOURCES),
  campaignName: nullableTrimmed,
  count: z.number().int().min(0, "Count cannot be negative"),
  userId: z.number().int().positive().nullable().optional(),
});

export type LeadCorePayload = z.infer<typeof leadCoreSchema>;

// A LOST lead must carry a reason; any other status must not (§3.1).
export function validateLostReason(
  status: string,
  lostReason: string | null | undefined
): string | null {
  if (status === "LOST" && !lostReason) return "A lost reason is required";
  return null;
}

// Resolve {itemType,id} picks to name snapshots from the live catalog (never
// trust client-sent names). Unknown ids are dropped.
export async function resolveInterested(
  db: Tx,
  items: { itemType: "PRODUCT" | "PACKAGE"; id: number }[]
): Promise<InterestedItem[]> {
  if (items.length === 0) return [];
  const productIds = items.filter((i) => i.itemType === "PRODUCT").map((i) => i.id);
  const packageIds = items.filter((i) => i.itemType === "PACKAGE").map((i) => i.id);
  const [products, packages] = await Promise.all([
    productIds.length
      ? db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    packageIds.length
      ? db.package.findMany({ where: { id: { in: packageIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const packageName = new Map(packages.map((p) => [p.id, p.name]));
  const out: InterestedItem[] = [];
  for (const it of items) {
    const name =
      it.itemType === "PRODUCT" ? productName.get(it.id) : packageName.get(it.id);
    if (name) out.push({ itemType: it.itemType, id: it.id, name });
  }
  return out;
}

// ---------- serialization ----------

export const LEAD_INCLUDE = {
  assignee: { select: { id: true, name: true } },
  convertedOrder: { select: { id: true, orderNo: true } },
} satisfies Prisma.LeadInclude;

export type LeadWithRelations = Prisma.LeadGetPayload<{ include: typeof LEAD_INCLUDE }>;

export function serializeLead(l: LeadWithRelations): LeadRow {
  return {
    id: l.id,
    leadDate: l.leadDate.toISOString().slice(0, 10),
    source: l.source,
    campaignName: l.campaignName,
    customerName: l.customerName,
    country: l.country,
    whatsappNumber: l.whatsappNumber,
    interestedIn: Array.isArray(l.interestedIn)
      ? (l.interestedIn as unknown as InterestedItem[])
      : [],
    status: l.status,
    committedAt: l.committedAt ? l.committedAt.toISOString() : null,
    followUpAt: l.followUpAt ? l.followUpAt.toISOString() : null,
    lostReason: l.lostReason,
    notes: l.notes,
    assignedToId: l.assignee.id,
    assignedToName: l.assignee.name,
    teamId: l.teamId,
    convertedOrder: l.convertedOrder
      ? { id: l.convertedOrder.id, orderNo: l.convertedOrder.orderNo }
      : null,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

// ---------- duplicate phone check (SPEC §3.1) ----------

export interface DuplicateHit {
  leads: LeadRow[];
  customer: {
    id: number;
    name: string;
    country: string;
    orderCount: number;
  } | null;
}

// Warn when a WhatsApp number already exists as a lead or a saved customer, and
// return the history so the SE sees who they're re-contacting (§3.1).
export async function findDuplicates(
  phoneRaw: string,
  scopeWhere: Prisma.LeadWhereInput,
  db: Tx = prisma
): Promise<DuplicateHit> {
  const phone = normalizePhone(phoneRaw);
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return { leads: [], customer: null };

  const [leads, customer] = await Promise.all([
    db.lead.findMany({
      where: { AND: [scopeWhere, { whatsappNumber: { contains: digits } }] },
      include: LEAD_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.customer.findFirst({
      where: { phoneForeign: { contains: digits } },
      include: { _count: { select: { orders: true } } },
    }),
  ]);

  return {
    leads: leads.map(serializeLead),
    customer: customer
      ? {
          id: customer.id,
          name: customer.name,
          country: customer.country,
          orderCount: customer._count.orders,
        }
      : null,
  };
}

// ---------- follow-up reminders (SPEC §3.2) ----------

export interface FollowUps {
  overdue: LeadRow[]; // follow_up_at < now, still open — flagged red on the dashboard
  today: LeadRow[]; // follow_up_at within today (Asia/Dhaka), still open
  overdueCount: number;
  todayCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Follow-ups due today + overdue, within the caller's scope. Terminal leads
// (converted/lost) never surface — the reminder is to act on live prospects.
export async function buildFollowUps(
  scopeWhere: Prisma.LeadWhereInput,
  db: Tx = prisma
): Promise<FollowUps> {
  const now = new Date();
  const dayStart = dhakaDayStart(now);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const open = { status: { in: OPEN_LEAD_STATUSES } };

  const overdueWhere = { AND: [scopeWhere, open, { followUpAt: { lt: dayStart } }] };
  const todayWhere = {
    AND: [scopeWhere, open, { followUpAt: { gte: dayStart, lt: dayEnd } }],
  };

  // Rows are capped for display; counts are real (the overdue notice must say
  // 80 when there are 80, not 50).
  const [overdue, today, overdueCount, todayCount] = await Promise.all([
    db.lead.findMany({
      where: overdueWhere,
      include: LEAD_INCLUDE,
      orderBy: { followUpAt: "asc" },
      take: 50,
    }),
    db.lead.findMany({
      where: todayWhere,
      include: LEAD_INCLUDE,
      orderBy: { followUpAt: "asc" },
      take: 50,
    }),
    db.lead.count({ where: overdueWhere }),
    db.lead.count({ where: todayWhere }),
  ]);

  return {
    overdue: overdue.map(serializeLead),
    today: today.map(serializeLead),
    overdueCount,
    todayCount,
  };
}

// ---------- Committed queue (CORRECTIONS Leads §9) ----------

export interface CommittedLeadRow extends LeadRow {
  committedSince: string; // "45m" / "6h" / "2d 4h" — time since commitment
  chaseOverdue: boolean; // committed > 24h ago and still unpaid — chase hard
}

// Leads whose customer has verbally confirmed + promised the advance but
// hasn't paid. Oldest commitment first — these need chasing until the payment
// lands (a linked DRAFT order confirms → the lead flips to CONVERTED and
// drops out of this queue automatically). Age fields are precomputed here so
// components render them without clock calls.
export async function buildCommittedQueue(
  scopeWhere: Prisma.LeadWhereInput,
  db: Tx = prisma,
  take = 50
): Promise<CommittedLeadRow[]> {
  const rows = await db.lead.findMany({
    where: { AND: [scopeWhere, { status: "COMMITTED" }] },
    include: LEAD_INCLUDE,
    orderBy: [{ committedAt: "asc" }, { updatedAt: "asc" }],
    take,
  });
  const now = Date.now();
  return rows.map((l) => {
    const row = serializeLead(l);
    const since = row.committedAt ?? row.updatedAt;
    return {
      ...row,
      committedSince: timeSince(since, now),
      chaseOverdue: now - new Date(since).getTime() > DAY_MS,
    };
  });
}
