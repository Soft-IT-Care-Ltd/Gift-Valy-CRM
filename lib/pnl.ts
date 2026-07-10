import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { dhakaDayStart, dhakaMonthStart } from "./orders";
import { NON_SALE_STATUSES, type OrderStatusValue } from "./order-constants";
import { PURCHASE_EXPENSE_CATEGORY } from "./stock";
import { AD_COST_CATEGORY, type CostTypeValue } from "./expense-constants";
import {
  DEFAULT_PNL_SETTINGS,
  PNL_SETTINGS_KEY,
  normalizePnlSettings,
  round2,
  type AdAllocationMethod,
  type PnlSettings,
  type RevenueBasis,
} from "./pnl-constants";

// ============ SPEC §9.2 / §9.3 — Accounting & Profit/Loss (Module 7, R9) ============
//
// Three cost-visible views, all gated on reports.pnl (canSeeCosts), never reachable
// by Sales/TeamLeader/Packing (CLAUDE.md rule 1):
//   • per-order profit — the exact §9.2 formula per order (cost snapshots, actual
//     courier cost, packaging setting, allocated ad cost);
//   • daily summary (§9.3) — date-wise sales, collection, costs, net;
//   • monthly P&L (§9.2) — revenue − COGS − variable − fixed = net, with margins
//     and a vs-previous-month comparison.
//
// Two deliberate modelling rules keep the numbers honest:
//   1. COGS comes from unit_cost_snapshot (frozen at PACKED), the accrual cost of
//      goods actually sold — NOT from "Product Purchase" expenses. Purchase cash is
//      inventory (tracked for wallet balances / dues), so it is EXCLUDED from the
//      monthly operating costs to avoid double-counting the cost of goods.
//   2. The per-order view uses per-order actuals (shipment.courier_cost_actual,
//      the packaging setting, day-allocated ad); the monthly P&L uses the expense
//      ledger. They are two lenses on the same business and won't tie to the taka.

type Tx = Prisma.TransactionClient | PrismaClient;

const DAY_MS = 24 * 60 * 60 * 1000;

// YYYY-MM-DD for a Date in Asia/Dhaka (en-CA renders ISO date order).
export function dhakaYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// YYYY-MM for a Date in Asia/Dhaka.
export function dhakaYm(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
  }).format(d);
}

// [start, next) calendar-month bounds in Asia/Dhaka for a "YYYY-MM" key.
function dhakaMonthBounds(ym: string): { start: Date; next: Date } {
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(`${ym}-01T00:00:00+06:00`);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const next = new Date(
    `${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+06:00`
  );
  return { start, next };
}

function prevYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

// Long month label ("July 2026") for a "YYYY-MM" key, in Asia/Dhaka.
export function monthLabel(ym: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    month: "long",
    year: "numeric",
  }).format(new Date(`${ym}-01T00:00:00+06:00`));
}

const pct = (num: number, den: number) => (den > 0 ? round2((num / den) * 100) : 0);

// ---------- settings (SPEC §9.2 — packaging cost + ad-cost allocation) ----------

export async function getPnlSettings(db: Tx = prisma): Promise<PnlSettings> {
  const row = await db.setting.findUnique({ where: { key: PNL_SETTINGS_KEY } });
  return normalizePnlSettings(
    (row?.value as Partial<PnlSettings> | undefined) ?? null
  );
}

export async function savePnlSettings(
  raw: unknown,
  db: Tx = prisma
): Promise<PnlSettings> {
  const settings = normalizePnlSettings(raw as Partial<PnlSettings>);
  await db.setting.upsert({
    where: { key: PNL_SETTINGS_KEY },
    update: { value: settings as unknown as Prisma.InputJsonValue },
    create: {
      key: PNL_SETTINGS_KEY,
      value: settings as unknown as Prisma.InputJsonValue,
    },
  });
  return settings;
}

// ============ Per-order profit (SPEC §9.2) ============
//
//   Order profit = sell value
//                − Σ(product cost, from unit_cost_snapshot at packing)
//                − actual courier cost (incl. COD fee, from the shipment)
//                − packaging cost (standard per-order rate, setting)
//                − allocated ad cost (day's ad spend ÷ day's confirmed orders,
//                                     or a manual % of sell value)

export interface OrderProfitParts {
  sellValue: number;
  productCost: number;
  courierCost: number;
  packagingCost: number;
  adCost: number;
  profit: number;
  marginPct: number; // profit ÷ sell value
  hasCostSnapshot: boolean; // every item carries a frozen cost (order was PACKED)
  hasCourierActual: boolean; // a shipment exists with an actual courier cost
}

// Pure calculation — shared by the report builder and the verify script so the
// formula lives in exactly one place. `allocatedAd` is the ad cost already
// resolved for this order (per the active allocation method).
export function computeOrderProfit(input: {
  sellValue: number;
  items: { qty: number; unitCostSnapshot: number | null }[];
  courierCostActual: number | null;
  hasShipment: boolean;
  packagingCost: number;
  allocatedAd: number;
}): OrderProfitParts {
  const hasCostSnapshot =
    input.items.length > 0 && input.items.every((it) => it.unitCostSnapshot != null);
  const productCost = round2(
    input.items.reduce((s, it) => s + Number(it.unitCostSnapshot ?? 0) * it.qty, 0)
  );
  const hasCourierActual = input.hasShipment && input.courierCostActual != null;
  const courierCost = round2(Number(input.courierCostActual ?? 0));
  const packagingCost = round2(input.packagingCost);
  const adCost = round2(input.allocatedAd);
  const profit = round2(
    input.sellValue - productCost - courierCost - packagingCost - adCost
  );
  return {
    sellValue: round2(input.sellValue),
    productCost,
    courierCost,
    packagingCost,
    adCost,
    profit,
    marginPct: pct(profit, input.sellValue),
    hasCostSnapshot,
    hasCourierActual,
  };
}

export interface OrderProfitRow extends OrderProfitParts {
  orderId: number;
  orderNo: string;
  createdAt: string; // ISO
  status: OrderStatusValue;
  isSale: boolean; // counts toward totals (not cancelled/returned/refunded)
  customerName: string;
  district: string;
  salesExecutive: string;
}

export interface PerOrderProfitReport {
  range: { from: string; to: string };
  settings: PnlSettings;
  adAllocationMethod: AdAllocationMethod;
  rows: OrderProfitRow[];
  totals: {
    orderCount: number; // sale orders only
    sellValue: number;
    productCost: number;
    courierCost: number;
    packagingCost: number;
    adCost: number;
    profit: number;
    marginPct: number;
    avgProfit: number;
  };
  incompleteCostCount: number; // sale rows missing a cost snapshot or courier actual
}

// Build the per-day ad allocation map (SPEC §9.2 default method): for each Dhaka
// day, that day's total ad spend ÷ that day's confirmed-order count. Both sides
// are measured over the same window as the orders being priced, so the shares of
// a day's ad spend sum back to that day's spend (for days that had ≥1 order).
async function buildAdAllocationByDay(
  db: Tx,
  from: Date,
  to: Date
): Promise<Map<string, number>> {
  const [adRows, orderDays] = await Promise.all([
    db.expense.findMany({
      where: {
        expenseDate: { gte: from, lte: to },
        category: { name: AD_COST_CATEGORY },
      },
      select: { expenseDate: true, amount: true },
    }),
    db.order.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { createdAt: true },
    }),
  ]);

  const spendByDay = new Map<string, number>();
  for (const e of adRows) {
    const k = dhakaYmd(e.expenseDate);
    spendByDay.set(k, round2((spendByDay.get(k) ?? 0) + Number(e.amount)));
  }
  const countByDay = new Map<string, number>();
  for (const o of orderDays) {
    const k = dhakaYmd(o.createdAt);
    countByDay.set(k, (countByDay.get(k) ?? 0) + 1);
  }

  const perOrder = new Map<string, number>();
  for (const [day, spend] of spendByDay) {
    perOrder.set(day, round2(spend / Math.max(countByDay.get(day) ?? 0, 1)));
  }
  return perOrder;
}

export async function buildPerOrderProfitReport(
  opts: { from?: Date; to?: Date; seId?: number },
  db: Tx = prisma
): Promise<PerOrderProfitReport> {
  const from = opts.from ?? dhakaMonthStart();
  const to = opts.to ?? new Date(dhakaDayStart().getTime() + DAY_MS - 1);
  const settings = await getPnlSettings(db);

  const where: Prisma.OrderWhereInput = {
    createdAt: { gte: from, lte: to },
    // LEAD/FOLLOW_UP live in the Leads module; the orders table starts at CONFIRMED.
    status: { notIn: ["LEAD", "FOLLOW_UP"] },
    ...(opts.seId ? { salesExecutiveId: opts.seId } : {}),
  };

  const [orders, adAllocByDay] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderNo: true,
        createdAt: true,
        status: true,
        totalAmount: true,
        district: true,
        customer: { select: { name: true } },
        salesExecutive: { select: { name: true } },
        items: { select: { qty: true, unitCostSnapshot: true } },
        shipment: { select: { courierCostActual: true } },
      },
    }),
    settings.adAllocationMethod === "daily_average"
      ? buildAdAllocationByDay(db, from, to)
      : Promise.resolve(new Map<string, number>()),
  ]);

  const rows: OrderProfitRow[] = orders.map((o) => {
    const sellValue = Number(o.totalAmount);
    const allocatedAd =
      settings.adAllocationMethod === "manual_percent"
        ? round2((sellValue * settings.adManualPercent) / 100)
        : adAllocByDay.get(dhakaYmd(o.createdAt)) ?? 0;

    const parts = computeOrderProfit({
      sellValue,
      items: o.items.map((it) => ({
        qty: it.qty,
        unitCostSnapshot: it.unitCostSnapshot != null ? Number(it.unitCostSnapshot) : null,
      })),
      courierCostActual:
        o.shipment?.courierCostActual != null
          ? Number(o.shipment.courierCostActual)
          : null,
      hasShipment: o.shipment != null,
      packagingCost: settings.packagingCostPerOrder,
      allocatedAd,
    });

    return {
      orderId: o.id,
      orderNo: o.orderNo,
      createdAt: o.createdAt.toISOString(),
      status: o.status as OrderStatusValue,
      isSale: !NON_SALE_STATUSES.includes(o.status as OrderStatusValue),
      customerName: o.customer.name,
      district: o.district,
      salesExecutive: o.salesExecutive.name,
      ...parts,
    };
  });

  // Totals over real sales only (cancelled/returned/refunded carry no sale value).
  const saleRows = rows.filter((r) => r.isSale);
  const sum = (f: (r: OrderProfitRow) => number) =>
    round2(saleRows.reduce((s, r) => s + f(r), 0));
  const sellValue = sum((r) => r.sellValue);
  const profit = sum((r) => r.profit);
  const incompleteCostCount = saleRows.filter(
    (r) => !r.hasCostSnapshot || !r.hasCourierActual
  ).length;

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    settings,
    adAllocationMethod: settings.adAllocationMethod,
    rows,
    totals: {
      orderCount: saleRows.length,
      sellValue,
      productCost: sum((r) => r.productCost),
      courierCost: sum((r) => r.courierCost),
      packagingCost: sum((r) => r.packagingCost),
      adCost: sum((r) => r.adCost),
      profit,
      marginPct: pct(profit, sellValue),
      avgProfit: saleRows.length > 0 ? round2(profit / saleRows.length) : 0,
    },
    incompleteCostCount,
  };
}

// ============ Daily summary (SPEC §9.3) ============
// A date-wise day-book: orders & sales value booked, cash collected, costs paid,
// and the day's net (sales − costs). Sales are accrual (booked at confirmation),
// collection & costs are cash (by payment/expense date) — the columns are shown
// side by side exactly as §9.3 lists them.

export interface DailySummaryRow {
  date: string; // YYYY-MM-DD (Asia/Dhaka)
  orders: number; // confirmed sales that day
  salesValue: number; // Σ order total of those
  collection: number; // Σ payments received (net of refunds), rejected excluded
  costs: number; // Σ expenses paid that day
  net: number; // salesValue − costs
}

export interface DailySummary {
  range: { from: string; to: string };
  continuous: boolean; // false when the range is too long for a zero-filled series
  rows: DailySummaryRow[];
  totals: {
    orders: number;
    salesValue: number;
    collection: number;
    costs: number;
    net: number;
  };
  peakValue: number; // max(salesValue, costs) across days — chart y-scale
}

const DAILY_MAX_DAYS = 120;

export async function buildDailySummary(
  opts: { from?: Date; to?: Date },
  db: Tx = prisma
): Promise<DailySummary> {
  const from = opts.from ?? dhakaMonthStart();
  const to = opts.to ?? new Date(dhakaDayStart().getTime() + DAY_MS - 1);

  const [orders, payments, expenses] = await Promise.all([
    db.order.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { notIn: NON_SALE_STATUSES },
      },
      select: { createdAt: true, totalAmount: true },
    }),
    db.payment.findMany({
      where: { paymentDate: { gte: from, lte: to }, isRejected: false },
      select: { paymentDate: true, amount: true, type: true },
    }),
    db.expense.findMany({
      where: { expenseDate: { gte: from, lte: to } },
      select: { expenseDate: true, amount: true },
    }),
  ]);

  type Acc = { orders: number; salesValue: number; collection: number; costs: number };
  const byDay = new Map<string, Acc>();
  const bump = (k: string): Acc => {
    let a = byDay.get(k);
    if (!a) {
      a = { orders: 0, salesValue: 0, collection: 0, costs: 0 };
      byDay.set(k, a);
    }
    return a;
  };

  for (const o of orders) {
    const a = bump(dhakaYmd(o.createdAt));
    a.orders += 1;
    a.salesValue = round2(a.salesValue + Number(o.totalAmount));
  }
  for (const p of payments) {
    const a = bump(dhakaYmd(p.paymentDate));
    const amt = Number(p.amount);
    a.collection = round2(a.collection + (p.type === "REFUND" ? -amt : amt));
  }
  for (const e of expenses) {
    const a = bump(dhakaYmd(e.expenseDate));
    a.costs = round2(a.costs + Number(e.amount));
  }

  // Zero-filled continuous series for reasonable ranges; else only active days.
  const startDay = dhakaDayStart(from);
  const endDay = dhakaDayStart(to);
  const dayCount =
    Math.floor((endDay.getTime() - startDay.getTime()) / DAY_MS) + 1;
  const continuous = dayCount > 0 && dayCount <= DAILY_MAX_DAYS;

  const keys = continuous
    ? Array.from({ length: dayCount }, (_, i) =>
        dhakaYmd(new Date(startDay.getTime() + i * DAY_MS))
      )
    : [...byDay.keys()].sort((a, b) => a.localeCompare(b));

  const rows: DailySummaryRow[] = keys.map((date) => {
    const a = byDay.get(date) ?? { orders: 0, salesValue: 0, collection: 0, costs: 0 };
    return {
      date,
      orders: a.orders,
      salesValue: a.salesValue,
      collection: a.collection,
      costs: a.costs,
      net: round2(a.salesValue - a.costs),
    };
  });

  const totals = rows.reduce(
    (t, r) => ({
      orders: t.orders + r.orders,
      salesValue: round2(t.salesValue + r.salesValue),
      collection: round2(t.collection + r.collection),
      costs: round2(t.costs + r.costs),
      net: round2(t.net + r.net),
    }),
    { orders: 0, salesValue: 0, collection: 0, costs: 0, net: 0 }
  );

  const peakValue = rows.reduce(
    (m, r) => Math.max(m, r.salesValue, r.costs),
    0
  );

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    continuous,
    rows,
    totals,
    peakValue,
  };
}

// ============ Monthly P&L (SPEC §9.2) ============
//   Revenue (confirmed/delivered basis)
//   − COGS (product cost of sold items, from snapshots)
//   = Gross profit
//   − Variable costs (ad, courier, packaging, MFS fees… — expense ledger,
//                     excluding inventory purchases which COGS already covers)
//   − Fixed costs (salary, rent, utilities…)
//   = Net profit  | gross margin %, net margin %, per-order avg profit

export interface PnlCategoryLine {
  name: string;
  costType: CostTypeValue;
  amount: number;
}

export interface MonthlyPnlPeriod {
  ym: string;
  label: string;
  basis: RevenueBasis;
  revenue: number;
  orderCount: number;
  cogs: number;
  cogsIncompleteCount: number; // sale orders whose items aren't fully snapshotted
  grossProfit: number;
  grossMarginPct: number;
  variableCost: number;
  fixedCost: number;
  operatingCost: number;
  netProfit: number;
  netMarginPct: number;
  perOrderAvgProfit: number;
  variableLines: PnlCategoryLine[];
  fixedLines: PnlCategoryLine[];
  inventoryPurchased: number; // Σ "Product Purchase" expenses — excluded (info only)
}

export interface MonthlyPnl {
  current: MonthlyPnlPeriod;
  previous: MonthlyPnlPeriod;
  deltas: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    variableCost: number;
    fixedCost: number;
    netProfit: number;
  };
}

const DELIVERED_STATUSES: OrderStatusValue[] = ["DELIVERED", "COMPLETED"];

async function buildPnlPeriod(
  db: Tx,
  ym: string,
  basis: RevenueBasis
): Promise<MonthlyPnlPeriod> {
  const { start, next } = dhakaMonthBounds(ym);

  // --- revenue orders on the chosen basis ---
  let orders: {
    totalAmount: Prisma.Decimal;
    items: { qty: number; unitCostSnapshot: Prisma.Decimal | null }[];
  }[];
  if (basis === "delivered") {
    // Recognised when delivered: shipment.deliveredAt in month (fall back to
    // createdAt for delivered orders that carry no shipment timestamp).
    const candidates = await db.order.findMany({
      where: {
        status: { in: DELIVERED_STATUSES },
        OR: [
          { shipment: { deliveredAt: { gte: start, lt: next } } },
          { shipment: { is: null }, createdAt: { gte: start, lt: next } },
          { shipment: { deliveredAt: null }, createdAt: { gte: start, lt: next } },
        ],
      },
      select: {
        totalAmount: true,
        createdAt: true,
        items: { select: { qty: true, unitCostSnapshot: true } },
        shipment: { select: { deliveredAt: true } },
      },
    });
    orders = candidates.filter((o) => {
      const rec = o.shipment?.deliveredAt ?? o.createdAt;
      return rec >= start && rec < next;
    });
  } else {
    // Booked at confirmation: created in month, excluding non-sale outcomes.
    orders = await db.order.findMany({
      where: {
        createdAt: { gte: start, lt: next },
        status: { notIn: NON_SALE_STATUSES },
      },
      select: {
        totalAmount: true,
        items: { select: { qty: true, unitCostSnapshot: true } },
      },
    });
  }

  let revenue = 0;
  let cogs = 0;
  let cogsIncompleteCount = 0;
  for (const o of orders) {
    revenue = round2(revenue + Number(o.totalAmount));
    let complete = o.items.length > 0;
    for (const it of o.items) {
      if (it.unitCostSnapshot == null) complete = false;
      else cogs = round2(cogs + Number(it.unitCostSnapshot) * it.qty);
    }
    if (!complete) cogsIncompleteCount += 1;
  }
  const orderCount = orders.length;

  // --- operating costs from the expense ledger ---
  const expenses = await db.expense.findMany({
    where: { expenseDate: { gte: start, lt: next } },
    select: {
      amount: true,
      category: { select: { name: true, costType: true } },
    },
  });

  const varMap = new Map<string, PnlCategoryLine>();
  const fixMap = new Map<string, PnlCategoryLine>();
  let inventoryPurchased = 0;
  for (const e of expenses) {
    const amt = Number(e.amount);
    // Inventory purchases are excluded — COGS already expenses goods when sold.
    if (e.category.name === PURCHASE_EXPENSE_CATEGORY) {
      inventoryPurchased = round2(inventoryPurchased + amt);
      continue;
    }
    const map = e.category.costType === "FIXED" ? fixMap : varMap;
    const line =
      map.get(e.category.name) ?? {
        name: e.category.name,
        costType: e.category.costType as CostTypeValue,
        amount: 0,
      };
    line.amount = round2(line.amount + amt);
    map.set(e.category.name, line);
  }

  const variableLines = [...varMap.values()].sort((a, b) => b.amount - a.amount);
  const fixedLines = [...fixMap.values()].sort((a, b) => b.amount - a.amount);
  const variableCost = round2(variableLines.reduce((s, l) => s + l.amount, 0));
  const fixedCost = round2(fixedLines.reduce((s, l) => s + l.amount, 0));
  const operatingCost = round2(variableCost + fixedCost);

  const grossProfit = round2(revenue - cogs);
  const netProfit = round2(grossProfit - operatingCost);

  return {
    ym,
    label: monthLabel(ym),
    basis,
    revenue,
    orderCount,
    cogs,
    cogsIncompleteCount,
    grossProfit,
    grossMarginPct: pct(grossProfit, revenue),
    variableCost,
    fixedCost,
    operatingCost,
    netProfit,
    netMarginPct: pct(netProfit, revenue),
    perOrderAvgProfit: orderCount > 0 ? round2(netProfit / orderCount) : 0,
    variableLines,
    fixedLines,
    inventoryPurchased,
  };
}

export async function buildMonthlyPnl(
  opts: { ym?: string; basis?: RevenueBasis },
  db: Tx = prisma
): Promise<MonthlyPnl> {
  const ym = opts.ym ?? dhakaYm();
  const basis: RevenueBasis = opts.basis ?? "confirmed";

  const [current, previous] = await Promise.all([
    buildPnlPeriod(db, ym, basis),
    buildPnlPeriod(db, prevYm(ym), basis),
  ]);

  return {
    current,
    previous,
    deltas: {
      revenue: round2(current.revenue - previous.revenue),
      cogs: round2(current.cogs - previous.cogs),
      grossProfit: round2(current.grossProfit - previous.grossProfit),
      variableCost: round2(current.variableCost - previous.variableCost),
      fixedCost: round2(current.fixedCost - previous.fixedCost),
      netProfit: round2(current.netProfit - previous.netProfit),
    },
  };
}

// Re-export so pages can pull settings defaults/types from one module.
export { DEFAULT_PNL_SETTINGS };
