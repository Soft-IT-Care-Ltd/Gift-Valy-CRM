import type { Prisma, PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { z } from "zod";
import { prisma } from "./db";
import { AuthzError } from "./authz";
import { syncReservations, syncStockForStatus } from "./stock";
import {
  ALLOWED_TRANSITIONS,
  CUSTOMER_COUNTRIES,
  DELIVERY_DATE_MODES,
  DELIVERY_ZONES,
  MFS_METHODS,
  OCCASIONS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  RECIPIENT_RELATIONS,
  TRASH_RETENTION_DAYS,
  type OrderStatusValue,
  type PaymentMethodValue,
} from "./order-constants";
import { upsertRecipientOccasions } from "./occasions";
import { timeSince } from "./lead-constants";
import {
  BomError,
  collectChoiceGroups,
  resolveChoice,
  type StoredChoiceSelection,
} from "./bom";
import { loadBomCatalog } from "./bom-db";

type Tx = Prisma.TransactionClient | PrismaClient;

// ---------- scope (SPEC §2.2: SE own / TL team / Manager+Admin all) ----------

export type OrderScope = "all" | "team" | "own";

export function orderViewScope(permissions: string[]): OrderScope | null {
  if (permissions.includes("orders.view_all")) return "all";
  if (permissions.includes("orders.view_team")) return "team";
  if (permissions.includes("orders.view_own")) return "own";
  return null;
}

// Prisma where clause limiting orders to what this user may see.
export async function orderScopeWhere(
  session: Session,
  permissions: string[]
): Promise<Prisma.OrderWhereInput> {
  const scope = orderViewScope(permissions);
  if (!scope) throw new AuthzError(403, "No order view permission");
  if (scope === "all") return {};
  if (scope === "own") return { salesExecutiveId: session.user.id };
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { teamId: true, leaderOf: { select: { id: true } } },
  });
  const teamIds = [
    ...(user?.teamId ? [user.teamId] : []),
    ...(user?.leaderOf.map((t) => t.id) ?? []),
  ];
  return {
    OR: [{ salesExecutiveId: session.user.id }, { teamId: { in: teamIds } }],
  };
}

// ---------- list filters & pagination (shared by page and GET /api/orders) ----------

export const ORDER_PAGE_SIZE = 25;

// First moment of the current calendar month in Asia/Dhaka — the default
// window that keeps the list (and tab counts) bounded as data grows.
export function dhakaMonthStart(date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  return new Date(`${y}-${m}-01T00:00:00+06:00`);
}

// First moment of the current calendar day in Asia/Dhaka ("today" on the
// SE dashboard follows office time, not the server's timezone).
export function dhakaDayStart(date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return new Date(`${y}-${m}-${d}T00:00:00+06:00`);
}

// `@db.Date` day helpers live in order-constants (leaf module, no import
// cycles); re-exported here alongside the other Dhaka date helpers.
export { dhakaDateBound, dbDate } from "./order-constants";

export interface OrderListQuery {
  // every non-status filter — tab counts group over these
  baseFilters: Prisma.OrderWhereInput[];
  // baseFilters + status — the visible list; in trash mode: the trashed rows
  filters: Prisma.OrderWhereInput[];
  // scope + search + SE, no dates — the Trash tab ignores the date window
  // (a trashed order must stay visible for its whole 30-day countdown), and
  // its tab count is computed over these (CORRECTIONS Orders §6f).
  trashFilters: Prisma.OrderWhereInput[];
  page: number;
  status: OrderStatusValue | null;
  q: string;
  rangeAll: boolean;
  trash: boolean; // ?status=TRASH — the Trash tab is active
}

// URL params → Prisma filters. Defaults to the current Dhaka month unless the
// caller sets explicit dates, ?range=all, or a search — search always spans
// all history (finding an old order is its whole point).
export function buildOrderListFilters(
  params: Record<string, string | undefined>,
  scope: Prisma.OrderWhereInput
): OrderListQuery {
  const q = (params.q ?? "").trim();
  const rangeAll = params.range === "all";
  const trash = params.status === "TRASH";

  const status =
    !trash &&
    params.status &&
    ORDER_STATUSES.includes(params.status as OrderStatusValue)
      ? (params.status as OrderStatusValue)
      : null;

  // scope + search + SE — shared by the dated live list and the Trash tab.
  const nonDateFilters: Prisma.OrderWhereInput[] = [scope];
  if (q) {
    const digits = q.replace(/\D/g, "");
    const or: Prisma.OrderWhereInput[] = [
      { orderNo: { contains: q, mode: "insensitive" } },
      { customer: { is: { name: { contains: q, mode: "insensitive" } } } },
    ];
    if (digits.length >= 4) {
      or.push({ recipientPhoneBd: { contains: digits } });
      or.push({ customer: { is: { phoneForeign: { contains: digits } } } });
    }
    nonDateFilters.push({ OR: or });
  }
  const seId = Number(params.seId);
  if (seId) nonDateFilters.push({ salesExecutiveId: seId });

  const baseFilters: Prisma.OrderWhereInput[] = [...nonDateFilters];
  const hasFrom = !!params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from);
  const hasTo = !!params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to);
  if (hasFrom) {
    baseFilters.push({ createdAt: { gte: new Date(`${params.from}T00:00:00+06:00`) } });
  }
  if (hasTo) {
    baseFilters.push({ createdAt: { lte: new Date(`${params.to}T23:59:59+06:00`) } });
  }
  // The Pending Payment (Drafts) tab ignores the implicit month default —
  // a forgotten old draft must never fall out of view (CORRECTIONS Leads §10).
  // Explicit dates still apply.
  if (!hasFrom && !hasTo && !rangeAll && !q && status !== "DRAFT") {
    baseFilters.push({ createdAt: { gte: dhakaMonthStart() } });
  }

  // The explicit deletedAt mention opts these out of the lib/db.ts auto-filter.
  const trashFilters: Prisma.OrderWhereInput[] = [
    ...nonDateFilters,
    { deletedAt: { not: null } },
  ];

  const filters = trash
    ? trashFilters
    : status
      ? [...baseFilters, { status }]
      : [...baseFilters];

  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  return { baseFilters, filters, trashFilters, page, status, q, rangeAll, trash };
}

// ---------- payload validation (shared by create, edit, edit-request) ----------

const itemSchema = z
  .object({
    itemType: z.enum(["PRODUCT", "PACKAGE"]),
    productId: z.number().int().positive().nullable().optional(),
    packageId: z.number().int().positive().nullable().optional(),
    qty: z.number().int().min(1),
    unitPrice: z.number().min(0),
    // CORRECTIONS Products §5 — the SE's variant picks for the package's
    // choice groups: { [groupId (package_items.id)]: productId }. Missing
    // groups fall back to the group's default (validated server-side).
    choiceSelections: z
      .record(z.string(), z.number().int().positive())
      .nullable()
      .optional(),
  })
  .refine((it) => (it.itemType === "PRODUCT" ? !!it.productId : !!it.packageId), {
    message: "Line item must reference a product or a package",
  });

const enumOrNull = (values: readonly string[]) =>
  z
    .string()
    .nullable()
    .optional()
    .refine((v) => v == null || v === "" || values.includes(v), {
      message: "Invalid value",
    })
    .transform((v) => (v ? v : null));

const nullableTrimmed = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : null));

const nullableYmd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

// Sections B + C + D(cod) + notes — everything an order edit may change (§4.2).
// District/Thana are gone from the form (CORRECTIONS Orders §5) — only the
// full address remains; legacy columns keep "" for new orders.
export const orderCoreSchema = z
  .object({
    recipientName: z.string().trim().min(1),
    recipientPhoneBd: z.string().trim().min(6, "Recipient BD phone is required"),
    recipientRelation: enumOrNull(RECIPIENT_RELATIONS),
    deliveryAddress: z.string().trim().min(5, "Full delivery address is required"),
    occasion: enumOrNull(OCCASIONS),
    // CORRECTIONS Orders §7 (form part) — optional recipient occasion dates,
    // persisted on the customer↔recipient profile.
    recipientBirthday: nullableYmd,
    recipientAnniversary: nullableYmd,
    // CORRECTIONS Products §3 — recipient zone; the form auto-fills the delivery
    // charge from item zone charges when set. Optional (free delivery default).
    deliveryZone: enumOrNull(DELIVERY_ZONES),
    // CORRECTIONS Orders §1 — ASAP / Any day / Fixed; only FIXED carries a date.
    deliveryDateMode: z.enum(DELIVERY_DATE_MODES).default("ANY_DAY"),
    requestedDeliveryDate: nullableYmd,
    items: z.array(itemSchema).min(1, "At least one line item is required"),
    discountType: z.enum(["AMOUNT", "PERCENT"]).default("AMOUNT"),
    discountValue: z.number().min(0).default(0),
    courierCharge: z.number().min(0).default(0),
    codAmount: z.number().min(0).nullable().optional(), // null → defaults to due
    notes: nullableTrimmed, // Order Note — internal (CORRECTIONS Orders §6d)
    invoiceNote: nullableTrimmed, // printed on the invoice (customer-visible)
    courierNote: nullableTrimmed, // sent to Steadfast as the consignment `note`
  })
  .refine(
    (o) => o.deliveryDateMode !== "FIXED" || !!o.requestedDeliveryDate,
    { message: "A fixed delivery date requires picking the date" }
  );

// The stored date only means something in FIXED mode (§1).
export function deliveryDateForMode(payload: {
  deliveryDateMode: (typeof DELIVERY_DATE_MODES)[number];
  requestedDeliveryDate?: string | null;
}): Date | null {
  return payload.deliveryDateMode === "FIXED" && payload.requestedDeliveryDate
    ? new Date(payload.requestedDeliveryDate)
    : null;
}

export type OrderCorePayload = z.infer<typeof orderCoreSchema>;

export const createOrderSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(1),
    phoneForeign: z.string().trim().min(6, "Customer foreign phone is required"),
    country: z.enum(CUSTOMER_COUNTRIES),
    fbLink: z
      .string()
      .nullable()
      .optional()
      .transform((v) => (v?.trim() ? v.trim() : null)),
  }),
  order: orderCoreSchema,
  advance: z.object({
    amount: z.number().min(0),
    method: z.enum(PAYMENT_METHODS).optional(),
    walletId: z.number().int().positive().nullable().optional(), // required only when amount > 0 (checked in the route)
    transactionId: z
      .string()
      .nullable()
      .optional()
      .transform((v) => (v?.trim() ? v.trim() : null)),
    senderNumber: z
      .string()
      .nullable()
      .optional()
      .transform((v) => (v?.trim() ? v.trim() : null)),
    screenshotUrl: z
      .string()
      .nullable()
      .optional()
      .transform((v) => (v?.trim() ? v.trim() : null)),
  }),
  zeroAdvanceReason: z.string().trim().optional(), // Admin/TL override note (§1.3)
  // Set when the order is created from a lead (§3.2) — flips the lead to
  // Converted and links orders.lead_id (validated in the route).
  leadId: z.number().int().positive().nullable().optional(),
  // CORRECTIONS Leads §10 — save the fully-detailed order as a DRAFT before
  // the advance arrives: DRAFT-XXXX number, no reserve/invoice, source lead
  // flips to COMMITTED instead of CONVERTED.
  saveAsDraft: z.boolean().optional().default(false),
});

export type CreateOrderPayload = z.infer<typeof createOrderSchema>;

export function mfsTxnRequired(method: PaymentMethodValue | undefined): boolean {
  return !!method && MFS_METHODS.includes(method);
}

// ---------- totals & price-floor checks (§4.1 C) ----------

export interface ResolvedLine {
  itemType: "PRODUCT" | "PACKAGE";
  productId: number | null;
  packageId: number | null;
  name: string;
  qty: number;
  unitPrice: number;
  priceFloor: number;
  lineTotal: number;
  // Resolved variant picks (CORRECTIONS Products §5) — null for PRODUCT lines
  // and packages without choice groups.
  choiceSelections: StoredChoiceSelection[] | null;
}

export interface ResolvedTotals {
  lines: ResolvedLine[];
  subtotal: number;
  discountAmount: number;
  total: number;
  floorBreaches: string[]; // human-readable, one per below-floor line
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Resolves catalog items server-side (never trust client names/floors) and
// computes subtotal → discount → courier → total.
export async function resolveItemsAndTotals(
  db: Tx,
  payload: OrderCorePayload
): Promise<ResolvedTotals> {
  const productIds = payload.items
    .filter((i) => i.itemType === "PRODUCT")
    .map((i) => i.productId!)
    .filter((v, i, a) => a.indexOf(v) === i);
  const packageIds = payload.items
    .filter((i) => i.itemType === "PACKAGE")
    .map((i) => i.packageId!)
    .filter((v, i, a) => a.indexOf(v) === i);

  const [products, packages] = await Promise.all([
    db.product.findMany({ where: { id: { in: productIds } } }),
    db.package.findMany({ where: { id: { in: packageIds } } }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const packageById = new Map(packages.map((p) => [p.id, p]));

  // Choice-group resolution (CORRECTIONS Products §5) needs the BOM graph —
  // only loaded when a package line exists.
  const catalog = packageIds.length > 0 ? await loadBomCatalog(db) : null;

  const lines: ResolvedLine[] = [];
  const floorBreaches: string[] = [];
  for (const it of payload.items) {
    let name: string;
    let priceFloor: number;
    let choiceSelections: StoredChoiceSelection[] | null = null;
    if (it.itemType === "PRODUCT") {
      const p = productById.get(it.productId!);
      if (!p) throw new AuthzError(400, `Product #${it.productId} not found`);
      if (!p.isActive) throw new AuthzError(400, `Product "${p.name}" is inactive`);
      // CORRECTIONS Products §1 — packing materials are never sold standalone.
      if (p.productType === "COMPONENT") {
        throw new AuthzError(
          400,
          `"${p.name}" is a packing material (component only) and cannot be sold standalone`
        );
      }
      name = p.name;
      priceFloor = Number(p.priceFloor);
    } else {
      const p = packageById.get(it.packageId!);
      if (!p) throw new AuthzError(400, `Package #${it.packageId} not found`);
      if (!p.isActive) throw new AuthzError(400, `Package "${p.name}" is inactive`);
      name = p.name;
      priceFloor = Number(p.priceFloor);
      // Resolve every choice group in the package tree: the SE's pick must be
      // a real option; missing picks fall back to the group's default. The
      // resolved set is snapshotted (label + product name) on the order item.
      try {
        const groups = collectChoiceGroups(catalog!, p.id);
        if (groups.length > 0) {
          const picks = new Map<number, number>();
          for (const [key, productId] of Object.entries(it.choiceSelections ?? {})) {
            picks.set(Number(key), productId);
          }
          choiceSelections = groups.map((g) => {
            const chosen = resolveChoice(
              {
                id: g.groupId,
                kind: "CHOICE",
                productId: null,
                childPackageId: null,
                choiceLabel: g.label,
                qty: g.qty,
                options: g.options,
              },
              picks
            );
            const product = catalog!.products.get(chosen);
            return {
              groupId: g.groupId,
              label: g.label,
              productId: chosen,
              name: product?.name ?? `#${chosen}`,
            };
          });
        }
      } catch (e) {
        if (e instanceof BomError) throw new AuthzError(400, e.message);
        throw e;
      }
    }
    if (it.unitPrice < priceFloor) {
      floorBreaches.push(
        `${name}: ৳${it.unitPrice} is below the price floor of ৳${priceFloor}`
      );
    }
    lines.push({
      itemType: it.itemType,
      productId: it.itemType === "PRODUCT" ? it.productId! : null,
      packageId: it.itemType === "PACKAGE" ? it.packageId! : null,
      name,
      qty: it.qty,
      unitPrice: round2(it.unitPrice),
      priceFloor,
      lineTotal: round2(it.qty * it.unitPrice),
      choiceSelections,
    });
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const discountAmount =
    payload.discountType === "PERCENT"
      ? round2((subtotal * payload.discountValue) / 100)
      : round2(payload.discountValue);
  if (payload.discountType === "PERCENT" && payload.discountValue > 100) {
    throw new AuthzError(400, "Discount percent cannot exceed 100");
  }
  if (discountAmount > subtotal) {
    throw new AuthzError(400, "Discount cannot exceed the items subtotal");
  }
  const total = round2(subtotal - discountAmount + payload.courierCharge);
  return { lines, subtotal, discountAmount, total, floorBreaches };
}

// ---------- order number GV-YYMM-XXXX (§4.2), month in Asia/Dhaka ----------

export function orderNoPrefix(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "2-digit",
    month: "2-digit",
  }).formatToParts(date);
  const yy = parts.find((p) => p.type === "year")!.value;
  const mm = parts.find((p) => p.type === "month")!.value;
  return `GV-${yy}${mm}-`;
}

export async function nextOrderNo(db: Tx, prefix: string): Promise<string> {
  const last = await db.order.findFirst({
    // The OR spans both trash states ON PURPOSE: mentioning deletedAt opts out
    // of the lib/db.ts trash auto-filter. A trashed order keeps its number
    // until the purge — hiding it here would reissue that number and the
    // unique(order_no) insert would collide forever (§6f).
    where: {
      orderNo: { startsWith: prefix },
      OR: [{ deletedAt: null }, { deletedAt: { not: null } }],
    },
    orderBy: { orderNo: "desc" },
    select: { orderNo: true },
  });
  const seq = last ? parseInt(last.orderNo.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

// CORRECTIONS Leads §10 — drafts get a temporary DRAFT-XXXX number (one global
// sequence); the real GV-YYMM-XXXX is assigned at CONFIRM so sales numbering
// stays clean. Same last-row + retry-on-P2002 pattern as nextOrderNo.
export const DRAFT_NO_PREFIX = "DRAFT-";

export async function nextDraftNo(db: Tx): Promise<string> {
  return nextOrderNo(db, DRAFT_NO_PREFIX);
}

export function isDraftNo(orderNo: string): boolean {
  return orderNo.startsWith(DRAFT_NO_PREFIX);
}

// ---------- draft → confirm (CORRECTIONS Leads §10) ----------

// Everything that happens when a draft's advance finally lands, in ONE place so
// the payments route (auto-confirm on payment) and the status route (manual
// DRAFT → CONFIRMED override) behave identically:
//   1. the real GV-YYMM-XXXX number replaces DRAFT-XXXX
//   2. status DRAFT → CONFIRMED + history row (via applyStatusTransition)
//   3. stock reserves (syncStockForStatus inside the transition)
//   4. advance_amount snapshots the total actually paid so far
//   5. the source lead (if any) flips COMMITTED → CONVERTED
// Caller owns the transaction and the P2002 retry on the order-number unique
// (concurrent confirms in the same month), plus invoice generation AFTER the
// transaction commits (SPEC §5, non-fatal).
export async function confirmDraftTx(
  tx: Prisma.TransactionClient,
  orderId: number,
  userId: number,
  note: string | null
): Promise<{ orderNo: string }> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payments: { select: { type: true, amount: true, isRejected: true } } },
  });
  if (order.status !== "DRAFT") {
    throw new AuthzError(400, `Order ${order.orderNo} is not a draft`);
  }

  const orderNo = await nextOrderNo(tx, orderNoPrefix());
  const paid = order.payments.reduce(
    (s, p) =>
      p.isRejected ? s : s + (p.type === "REFUND" ? -Number(p.amount) : Number(p.amount)),
    0
  );
  await tx.order.update({
    where: { id: orderId },
    data: {
      orderNo,
      advanceAmount: Math.max(paid, 0), // §4.1 D snapshot — the advance that confirmed it
      updatedBy: userId,
    },
  });
  await applyStatusTransition(
    tx,
    { id: order.id, status: "DRAFT", cancelReason: order.cancelReason },
    "CONFIRMED",
    userId,
    note ?? `Advance received — confirmed from draft ${order.orderNo}`
  );
  // Lead lifecycle (§10): draft creation put the lead at COMMITTED; the
  // confirmation is the real conversion.
  if (order.leadId != null) {
    await tx.lead.update({
      where: { id: order.leadId },
      data: { status: "CONVERTED", updatedBy: userId },
    });
  }
  return { orderNo };
}

// ---------- due recompute (CLAUDE.md rule 2 / SPEC integrity rule 1) ----------

// due = total − Σ(payments ≠ REFUND) + Σ(REFUND). Runs inside the same
// transaction as the payment write; also called after edits change the total.
// Rejected payments (money that never arrived, SPEC §8) are excluded, so
// rejecting a bogus payment restores the order's due.
export async function recomputeDue(tx: Tx, orderId: number): Promise<number> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { totalAmount: true },
  });
  const payments = await tx.payment.findMany({
    where: { orderId, isRejected: false },
    select: { type: true, amount: true },
  });
  const paid = payments.reduce(
    (s, p) => s + (p.type === "REFUND" ? -Number(p.amount) : Number(p.amount)),
    0
  );
  const due = round2(Number(order.totalAmount) - paid);
  await tx.order.update({ where: { id: orderId }, data: { dueAmount: due } });
  return due;
}

// ---------- status transitions (§1.3) ----------

// Permission per target status: Packing moves CONFIRMED→PACKED; cancel needs
// orders.cancel + reason (§4.2); everything else needs orders.edit.
export function statusChangePermitted(
  to: OrderStatusValue,
  permissions: string[]
): boolean {
  if (to === "PACKED") {
    return (
      permissions.includes("orders.pack") || permissions.includes("orders.edit")
    );
  }
  if (to === "CANCELLED") return permissions.includes("orders.cancel");
  return permissions.includes("orders.edit");
}

// Core status mutation shared by the order-status route and the courier module
// (SPEC §1.3): validate the transition, update the order, log to
// order_status_history (§4.2), and run the stock lifecycle hook (§6.3). The
// courier RETURNED flow passes skipStockSync so the stock restore waits for the
// separate Admin approval (§1.3). Caller owns permission/precondition checks and
// the audit log entry.
export async function applyStatusTransition(
  tx: Prisma.TransactionClient,
  order: { id: number; status: OrderStatusValue; cancelReason: string | null },
  to: OrderStatusValue,
  userId: number,
  note: string | null,
  opts: { skipStockSync?: boolean } = {}
) {
  if (!ALLOWED_TRANSITIONS[order.status].includes(to)) {
    throw new AuthzError(400, `Cannot move from ${order.status} to ${to}`);
  }
  await tx.order.update({
    where: { id: order.id },
    data: {
      status: to,
      cancelReason: to === "CANCELLED" ? note : order.cancelReason,
      updatedBy: userId,
    },
  });
  await tx.orderStatusHistory.create({
    data: {
      orderId: order.id,
      fromStatus: order.status,
      toStatus: to,
      byUser: userId,
      note,
    },
  });
  if (!opts.skipStockSync) {
    await syncStockForStatus(tx, order.id, to, userId, note);
  }
}

// ---------- edit window (§4.2) ----------

export function withinEditWindow(createdAt: Date, minutes: number): boolean {
  return Date.now() - createdAt.getTime() < minutes * 60_000;
}

// ---------- apply an edit (direct PATCH or approved edit request) ----------

// Replaces sections B/C fields + items, recomputes totals and due, and
// re-syncs stock reservations when the order is CONFIRMED (SPEC §6.3).
// Floor checks are the caller's job (they know who authorized the edit).
export async function applyOrderEdit(
  tx: Prisma.TransactionClient,
  orderId: number,
  payload: OrderCorePayload,
  totals: ResolvedTotals,
  userId: number
) {
  await tx.orderItem.deleteMany({ where: { orderId } });
  await tx.orderItem.createMany({
    data: totals.lines.map((l) => ({
      orderId,
      itemType: l.itemType,
      productId: l.productId,
      packageId: l.packageId,
      qty: l.qty,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      choiceSelections: l.choiceSelections
        ? (l.choiceSelections as unknown as Prisma.InputJsonValue)
        : undefined,
    })),
  });
  // District/Thana intentionally untouched (CORRECTIONS Orders §5): removed
  // from the form; legacy rows keep whatever they had.
  await tx.order.update({
    where: { id: orderId },
    data: {
      recipientName: payload.recipientName,
      recipientPhoneBd: payload.recipientPhoneBd,
      recipientRelation: payload.recipientRelation,
      deliveryAddress: payload.deliveryAddress,
      occasion: payload.occasion,
      deliveryZone: payload.deliveryZone as Prisma.OrderUpdateInput["deliveryZone"],
      deliveryDateMode: payload.deliveryDateMode,
      requestedDeliveryDate: deliveryDateForMode(payload),
      subtotal: totals.subtotal,
      discount: totals.discountAmount,
      courierChargeCustomer: payload.courierCharge,
      totalAmount: totals.total,
      notes: payload.notes,
      invoiceNote: payload.invoiceNote,
      courierNote: payload.courierNote,
      updatedBy: userId,
    },
  });
  // Occasion dates persist on the customer↔recipient profile (§7 form part).
  const { customerId } = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { customerId: true },
  });
  await upsertRecipientOccasions(tx, {
    customerId,
    recipientName: payload.recipientName,
    recipientPhoneBd: payload.recipientPhoneBd,
    relation: payload.recipientRelation,
    birthday: payload.recipientBirthday,
    anniversary: payload.recipientAnniversary,
    userId,
  });
  const due = await recomputeDue(tx, orderId);
  // COD: explicit value wins, otherwise follow the recomputed due (never < 0).
  const cod = payload.codAmount ?? Math.max(due, 0);
  await tx.order.update({ where: { id: orderId }, data: { codAmount: cod } });
  // Reservations track the items of a CONFIRMED order. PACKED edits don't
  // touch stock — the deduction reflects what was physically packed, and any
  // later cancel/return reverses the ledger, not the edited item list.
  const { status } = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { status: true },
  });
  if (status === "CONFIRMED") {
    await syncReservations(tx, orderId, userId);
  }
}

// ---------- serialization (field-level security per CLAUDE.md rule 1) ----------

export type OrderWithRelations = Prisma.OrderGetPayload<{
  include: {
    customer: true;
    salesExecutive: { select: { id: true; name: true } };
    team: { select: { id: true; name: true } };
    items: {
      include: {
        product: { select: { name: true; sku: true } };
        package: { select: { name: true; code: true } };
      };
    };
    payments: { include: { wallet: { select: { name: true } } } };
    statusHistory: { include: { user: { select: { name: true } } } };
    editRequests: { include: { requester: { select: { name: true } } } };
    invoices: true;
    whatsappMessages: true;
    shipment: {
      include: {
        courier: { select: { name: true } };
        trackingEvents: true;
      };
    };
  };
}>;

export const orderDetailInclude = {
  customer: true,
  salesExecutive: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  items: {
    include: {
      product: { select: { name: true, sku: true } },
      package: { select: { name: true, code: true } },
    },
  },
  payments: { include: { wallet: { select: { name: true } } } },
  statusHistory: { include: { user: { select: { name: true } } } },
  editRequests: { include: { requester: { select: { name: true } } } },
  invoices: true,
  // latest WhatsApp API send attempt (SPEC §5 / §16 Phase 4) — the invoice
  // card shows whether the customer actually got the PDF.
  whatsappMessages: { orderBy: { createdAt: "desc" as const }, take: 1 },
  shipment: {
    include: {
      courier: { select: { name: true } },
      trackingEvents: true,
    },
  },
} satisfies Prisma.OrderInclude;

// unit_cost_snapshot is a COST field — stripped unless the caller may see
// costs. Nothing else on an order is cost/profit data in Phase 1.
export function serializeOrderDetail(o: OrderWithRelations, showCosts: boolean) {
  return {
    id: o.id,
    orderNo: o.orderNo,
    status: o.status,
    cancelReason: o.cancelReason,
    createdAt: o.createdAt.toISOString(),
    customer: {
      id: o.customer.id,
      name: o.customer.name,
      phoneForeign: o.customer.phoneForeign,
      country: o.customer.country,
      fbLink: o.customer.fbLink,
    },
    recipientName: o.recipientName,
    recipientPhoneBd: o.recipientPhoneBd,
    recipientRelation: o.recipientRelation,
    deliveryAddress: o.deliveryAddress,
    district: o.district,
    thana: o.thana,
    deliveryZone: o.deliveryZone,
    occasion: o.occasion,
    deliveryDateMode: o.deliveryDateMode,
    requestedDeliveryDate: o.requestedDeliveryDate
      ? o.requestedDeliveryDate.toISOString().slice(0, 10)
      : null,
    items: o.items.map((it) => ({
      id: it.id,
      itemType: it.itemType,
      productId: it.productId,
      packageId: it.packageId,
      name:
        it.product?.name ?? it.package?.name ?? it.customName ?? "(custom)",
      code: it.product?.sku ?? it.package?.code ?? null,
      qty: it.qty,
      unitPrice: Number(it.unitPrice),
      lineTotal: Number(it.lineTotal),
      // Chosen variants (CORRECTIONS Products §5) — label/name snapshots.
      choiceSelections: (it.choiceSelections as
        | { groupId: number; label: string; productId: number; name: string }[]
        | null) ?? null,
      ...(showCosts && it.unitCostSnapshot != null
        ? { unitCostSnapshot: Number(it.unitCostSnapshot) }
        : {}),
    })),
    subtotal: Number(o.subtotal),
    discount: Number(o.discount),
    courierCharge: Number(o.courierChargeCustomer),
    totalAmount: Number(o.totalAmount),
    advanceAmount: Number(o.advanceAmount),
    dueAmount: Number(o.dueAmount),
    codAmount: Number(o.codAmount),
    notes: o.notes,
    invoiceNote: o.invoiceNote,
    courierNote: o.courierNote,
    salesExecutive: o.salesExecutive,
    team: o.team,
    payments: o.payments
      .slice()
      .sort((a, b) => a.paymentDate.getTime() - b.paymentDate.getTime())
      .map((p) => ({
        id: p.id,
        paymentDate: p.paymentDate.toISOString(),
        type: p.type,
        method: p.method,
        amount: Number(p.amount),
        transactionId: p.transactionId,
        senderNumber: p.senderNumber,
        screenshotUrl: p.screenshotUrl,
        walletId: p.walletId,
        walletName: p.wallet?.name ?? null,
        isVerified: p.isVerified,
        isRejected: p.isRejected,
        rejectionReason: p.rejectionReason,
      })),
    statusHistory: o.statusHistory
      .slice()
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((h) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        byUser: h.user.name,
        at: h.at.toISOString(),
        note: h.note,
      })),
    editRequests: o.editRequests
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({
        id: r.id,
        status: r.status,
        requestedBy: r.requester.name,
        reason: r.reason,
        reviewNote: r.reviewNote,
        createdAt: r.createdAt.toISOString(),
        changes: r.changesJson as OrderCorePayload,
      })),
    // newest first — [0] is the current invoice (§5 versioning)
    invoices: o.invoices
      .slice()
      .sort((a, b) => b.version - a.version)
      .map((inv) => ({
        id: inv.id,
        version: inv.version,
        generatedAt: inv.generatedAt.toISOString(),
      })),
    whatsappSend: o.whatsappMessages[0]
      ? {
          status: o.whatsappMessages[0].status,
          trigger: o.whatsappMessages[0].trigger,
          toPhone: o.whatsappMessages[0].toPhone,
          error: o.whatsappMessages[0].error,
          createdAt: o.whatsappMessages[0].createdAt.toISOString(),
        }
      : null,
    // SPEC §7 — the courier shipment, if handed over. courier_cost_actual is a
    // COST field, so it is only included for cost-visible roles.
    shipment: o.shipment
      ? {
          id: o.shipment.id,
          courier: o.shipment.courier.name,
          trackingNo: o.shipment.trackingNo,
          status: o.shipment.status,
          handoverDate: o.shipment.handoverDate.toISOString().slice(0, 10),
          expectedDelivery: o.shipment.expectedDelivery
            ? o.shipment.expectedDelivery.toISOString().slice(0, 10)
            : null,
          codAmount: Number(o.shipment.codAmount),
          codReceived: o.shipment.codReceived,
          codReceivedAt: o.shipment.codReceivedAt
            ? o.shipment.codReceivedAt.toISOString()
            : null,
          deliveredAt: o.shipment.deliveredAt
            ? o.shipment.deliveredAt.toISOString()
            : null,
          returnedAt: o.shipment.returnedAt
            ? o.shipment.returnedAt.toISOString()
            : null,
          returnApproved: o.shipment.returnApproved,
          // Steadfast integration (STEADFAST_INTEGRATION.md §3): raw courier
          // status, operator flags, and the tracking-event timeline (§3A payload 2).
          consignmentId:
            o.shipment.consignmentId != null
              ? Number(o.shipment.consignmentId)
              : null,
          steadfastStatus: o.shipment.steadfastStatus,
          onHold: o.shipment.onHold,
          needsAttention: o.shipment.needsAttention,
          trackingEvents: o.shipment.trackingEvents
            .slice()
            .sort((a, b) => b.eventAt.getTime() - a.eventAt.getTime())
            .map((t) => ({
              id: t.id,
              message: t.message,
              eventAt: t.eventAt.toISOString(),
              source: t.source,
            })),
          ...(showCosts && o.shipment.courierCostActual != null
            ? { courierCostActual: Number(o.shipment.courierCostActual) }
            : {}),
        }
      : null,
  };
}

// Shared include for list queries (page + GET /api/orders) — items feed the
// Items column badges (CORRECTIONS Orders §6c).
export const orderListInclude = {
  customer: { select: { name: true, phoneForeign: true, country: true } },
  salesExecutive: { select: { id: true, name: true } },
  items: {
    select: {
      id: true,
      qty: true,
      customName: true,
      product: { select: { name: true } },
      package: { select: { name: true } },
    },
  },
} satisfies Prisma.OrderInclude;

export type OrderListRow = Prisma.OrderGetPayload<{
  include: typeof orderListInclude;
}>;

export function serializeOrderListRow(o: OrderListRow) {
  return {
    id: o.id,
    orderNo: o.orderNo,
    createdAt: o.createdAt.toISOString(),
    customerName: o.customer.name,
    customerPhone: o.customer.phoneForeign,
    customerCountry: o.customer.country,
    recipientName: o.recipientName,
    // Recipient contact + COD — used by the "Send to Steadfast" confirm dialog
    // on the PACKED tab (STEADFAST_INTEGRATION.md §2). Not cost/profit data.
    recipientPhone: o.recipientPhoneBd,
    deliveryAddress: o.deliveryAddress,
    thana: o.thana,
    codAmount: Number(o.codAmount),
    district: o.district,
    totalAmount: Number(o.totalAmount),
    dueAmount: Number(o.dueAmount),
    status: o.status,
    // Delivery timing (CORRECTIONS Orders §1) — 🎯 fixed-date badges in lists.
    deliveryDateMode: o.deliveryDateMode,
    requestedDeliveryDate: o.requestedDeliveryDate
      ? o.requestedDeliveryDate.toISOString().slice(0, 10)
      : null,
    // Pending-Payment aging (CORRECTIONS Leads §10) — precomputed so the list
    // renders without clock calls; red once a draft is unpaid > 24h.
    draftAge:
      o.status === "DRAFT" ? timeSince(o.createdAt.toISOString()) : null,
    draftOverdue:
      o.status === "DRAFT" &&
      Date.now() - o.createdAt.getTime() > 24 * 60 * 60 * 1000,
    // 3-note system (§6d) — the list's Note modal reads and updates these.
    notes: o.notes,
    invoiceNote: o.invoiceNote,
    courierNote: o.courierNote,
    // Items column (§6c): resolved names + qty, first 1–2 shown as badges,
    // the rest behind a "+N more" chip.
    items: o.items.map((it) => ({
      id: it.id,
      name: it.product?.name ?? it.package?.name ?? it.customName ?? "(custom)",
      qty: it.qty,
    })),
    // Trash tab (§6f): when trashed, days until the 30-day purge.
    deletedAt: o.deletedAt ? o.deletedAt.toISOString() : null,
    purgeInDays: o.deletedAt
      ? Math.max(
          0,
          TRASH_RETENTION_DAYS -
            Math.floor((Date.now() - o.deletedAt.getTime()) / (24 * 60 * 60 * 1000))
        )
      : null,
    salesExecutive: o.salesExecutive.name,
    salesExecutiveId: o.salesExecutive.id,
  };
}
