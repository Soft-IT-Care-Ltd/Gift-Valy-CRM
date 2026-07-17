// Owner Dashboard data layer (SPEC §13). One aggregator that resolves the
// selected date window and composes every widget from the existing report
// builders — so a dashboard glance and the underlying report always agree.
//
// Everything here is server-only (imports prisma / server builders). Cost and
// profit figures are computed unconditionally but the page only RENDERS them
// for cost-visible viewers (canSeeCosts) — server components keep the numbers
// off the wire, satisfying the field-level-security rule for non-cost roles.

import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { dhakaDateBound, dhakaDayStart, dhakaMonthStart } from "./orders";
import { EXCLUDED_SALE_STATUSES, type OrderStatusValue } from "./order-constants";
import { buildDailySummary, dhakaYmd, dhakaYm, monthLabel } from "./pnl";
import {
  buildCollectionReport,
  buildCourierReport,
  buildExpenseReport,
  buildStockReport,
  buildPackageReport,
} from "./reports";
import { buildLeaderboard, buildTeamGauge } from "./targets";
import { whoIsInToday, type WhoIsInToday } from "./attendance";
import { getSteadfastIntegration } from "./steadfast-integration";
import { round2 } from "./pnl-constants";
import type { Gauge, LeaderboardRow } from "./targets-constants";
import {
  DASH_RANGE_POSSESSIVE,
  isDashRange,
  type DashRangeKey,
} from "./dashboard-constants";

const DAY_MS = 86_400_000;

// ---------- date window ----------

export interface DashWindow {
  range: DashRangeKey;
  from: Date;
  to: Date;
  fromYmd: string;
  toYmd: string;
  label: string; // human range, e.g. "1 Jul – 11 Jul 2026"
  possessive: string; // tile prefix, e.g. "This month's"
  singleDay: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function endOfDhakaDay(dayStart: Date): Date {
  return new Date(dayStart.getTime() + DAY_MS - 1);
}

function fmtYmdLong(ymd: string): string {
  return new Date(`${ymd}T00:00:00+06:00`).toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Resolve the URL params (?range&from&to) into a concrete Dhaka-time window.
export function resolveDashWindow(params: {
  range?: string;
  from?: string;
  to?: string;
}): DashWindow {
  const todayStart = dhakaDayStart();
  const endToday = endOfDhakaDay(todayStart);
  const range: DashRangeKey = isDashRange(params.range) ? params.range : "today";

  let from = todayStart;
  let to = endToday;

  if (range === "custom") {
    const hasFrom = params.from && DATE_RE.test(params.from);
    const hasTo = params.to && DATE_RE.test(params.to);
    from = hasFrom ? new Date(`${params.from}T00:00:00+06:00`) : todayStart;
    to = hasTo ? new Date(`${params.to}T23:59:59.999+06:00`) : endToday;
    if (from.getTime() > to.getTime()) [from, to] = [to, from];
  } else if (range === "yesterday") {
    from = new Date(todayStart.getTime() - DAY_MS);
    to = new Date(todayStart.getTime() - 1);
  } else if (range === "week") {
    // Calendar week starting Sunday in Dhaka (no DST, so day math in ms is
    // safe) — matches the app-wide date filter's "This Week".
    const dow = new Date(todayStart.getTime() + 6 * 3_600_000).getUTCDay();
    from = new Date(todayStart.getTime() - dow * DAY_MS);
  } else if (range === "month") {
    from = dhakaMonthStart();
  } else if (range === "lastmonth") {
    const thisStart = dhakaMonthStart();
    to = new Date(thisStart.getTime() - 1);
    from = dhakaMonthStart(to);
  }

  const fromYmd = dhakaYmd(from);
  const toYmd = dhakaYmd(to);
  const singleDay = fromYmd === toYmd;
  const label = singleDay
    ? fmtYmdLong(fromYmd)
    : `${fmtYmdLong(fromYmd)} – ${fmtYmdLong(toYmd)}`;

  return {
    range,
    from,
    to,
    fromYmd,
    toYmd,
    label,
    possessive: DASH_RANGE_POSSESSIVE[range],
    singleDay,
  };
}

// Previous calendar month window (Dhaka), for the MTD-vs-last-month compare.
function lastMonthWindow(): { start: Date; end: Date; ym: string } {
  const thisStart = dhakaMonthStart();
  const end = new Date(thisStart.getTime() - 1); // last moment of previous month
  const start = dhakaMonthStart(end);
  return { start, end, ym: dhakaYm(end) };
}

// ---------- widget shapes ----------

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}

export interface CountrySalesRow {
  country: string;
  orders: number;
  sales: number;
  share: number; // % of range sales
}

export interface ExpenseSlice {
  name: string;
  amount: number;
  share: number;
}

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  sales: number;
  collection: number;
}

// CORRECTIONS Dashboard §1–§7 — the top "Snapshot" KPI strip. Every figure
// keys off the same selected window as the rest of the dashboard (leads/orders/
// delivered/drafts by created_at in range; collections by payment_date in
// range). courierEnabled just says whether the balance widget may call out.
export interface DashboardSnapshot {
  leads: number; // §1 — detailed + bulk daily counts (matches leads.total)
  orders: number; // §2 — non-lost, non-draft orders created in range
  delivered: { count: number; amount: number }; // §3 — DELIVERED/COMPLETED in range
  advanceCollection: { count: number; amount: number }; // §4 — payments type ADVANCE
  // §5 — total collection split by source (each line = sum of payment types):
  //   advance = ADVANCE + PARTIAL · cod = COD_COURIER · postMfs = POST_DELIVERY_MFS
  collection: { advance: number; cod: number; postMfs: number; total: number };
  drafts: { count: number; amount: number }; // §7 — DRAFT (committed-but-unpaid) in range
  courierEnabled: boolean; // §6 — Steadfast integration on → balance widget may fetch
}

export interface OwnerDashboardData {
  window: DashWindow;
  // CORRECTIONS Dashboard §1–§7 — top KPI snapshot strip
  snapshot: DashboardSnapshot;
  // Row 1 — money over the selected range
  money: {
    orders: number;
    sales: number;
    collection: number;
    costs: number;
    net: number;
  };
  // Row 2 — month view (always MTD, independent of the range switch)
  month: {
    thisLabel: string;
    lastLabel: string;
    mtdSales: number;
    mtdNet: number;
    lastMonthSales: number; // full previous month
    lastMonthToDate: number; // previous month up to same day-of-month
    deltaPct: number | null; // MTD vs same-period last month
    labels: string[]; // day-of-month "1".."31"
    thisCumulative: number[]; // cumulative MTD sales
    lastCumulative: number[]; // cumulative last-month sales
  };
  dues: { totalOutstanding: number; orderCount: number };
  codPending: { count: number; amount: number };
  // Row 3 — operations
  funnel: FunnelStage[];
  funnelExtra: { onHold: number; cancelledReturned: number; totalInRange: number };
  inventory: {
    stockValue: number | null;
    trackedCount: number;
    lowStockCount: number;
    packageAlerts: number;
    activePackages: number;
  };
  // Row 4 — team
  leaderboard: LeaderboardRow[];
  teamGauges: Gauge[];
  leads: { total: number; converted: number; conversionPct: number | null };
  whoIsIn: WhoIsInToday;
  // Row 5 — charts
  trend30: { points: TrendPoint[]; peak: number };
  expenseSplit: { total: number; slices: ExpenseSlice[] } | null;
  countries: CountrySalesRow[];
}

// ---------- sub-builders ----------

// Order-status funnel for any order scope (owner: created-in-range; role homes:
// own/team orders). Exported so the SE/TL home dashboards reuse the same math.
export async function buildFunnel(where: Prisma.OrderWhereInput) {
  const grouped = await prisma.order.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
  });
  const by = new Map<OrderStatusValue, number>(
    grouped.map((g) => [g.status as OrderStatusValue, g._count._all])
  );
  const c = (...s: OrderStatusValue[]) =>
    s.reduce((n, k) => n + (by.get(k) ?? 0), 0);

  // Cumulative "reached at least this stage" so the funnel is monotonic.
  const deliveredPlus = c("DELIVERED", "COMPLETED");
  const shippedPlus = deliveredPlus + c("HANDED_TO_COURIER", "IN_TRANSIT");
  const packedPlus = shippedPlus + c("PACKED");
  const confirmedPlus = packedPlus + c("CONFIRMED");

  const funnel: FunnelStage[] = [
    { key: "confirmed", label: "Confirmed", count: confirmedPlus },
    { key: "packed", label: "Packed", count: packedPlus },
    { key: "shipped", label: "Shipped", count: shippedPlus },
    { key: "delivered", label: "Delivered", count: deliveredPlus },
  ];
  const totalInRange = grouped.reduce((n, g) => n + g._count._all, 0);
  return {
    funnel,
    funnelExtra: {
      onHold: c("ON_HOLD"),
      cancelledReturned: c("CANCELLED", "RETURNED", "REFUNDED"),
      totalInRange,
    },
  };
}

async function buildCountrySales(
  from: Date,
  to: Date
): Promise<CountrySalesRow[]> {
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: from, lte: to }, status: { notIn: EXCLUDED_SALE_STATUSES } },
    select: { totalAmount: true, customer: { select: { country: true } } },
  });
  const map = new Map<string, { orders: number; sales: number }>();
  let grand = 0;
  for (const o of orders) {
    const country = o.customer.country || "Unknown";
    const row = map.get(country) ?? { orders: 0, sales: 0 };
    row.orders += 1;
    row.sales += Number(o.totalAmount);
    map.set(country, row);
    grand += Number(o.totalAmount);
  }
  return [...map.entries()]
    .map(([country, v]) => ({
      country,
      orders: v.orders,
      sales: Math.round(v.sales * 100) / 100,
      share: grand > 0 ? Math.round((v.sales / grand) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.sales - a.sales);
}

async function buildTeamGauges(monthKey: string, now: Date): Promise<Gauge[]> {
  const teams = await prisma.team.findMany({ select: { id: true, name: true } });
  const gauges = await Promise.all(
    teams.map((t) => buildTeamGauge(t, monthKey, now))
  );
  // Teams with a target first (by progress), then untargeted teams with activity.
  return gauges
    .filter((g) => g.targetId != null || g.achievedAmount > 0 || g.achievedOrders > 0)
    .sort((a, b) => {
      const ap = a.primaryPct ?? -1;
      const bp = b.primaryPct ?? -1;
      return bp - ap;
    });
}

function cumulative(series: number[]): number[] {
  let run = 0;
  return series.map((v) => (run = Math.round((run + v) * 100) / 100));
}

// ---------- main aggregator ----------

export async function buildOwnerDashboard(
  window: DashWindow,
  opts: { showCosts: boolean; now?: Date }
): Promise<OwnerDashboardData> {
  const now = opts.now ?? new Date();
  const { from, to } = window;
  const monthKey = dhakaYm(now);
  const monthStart = dhakaMonthStart();
  const endToday = endOfDhakaDay(dhakaDayStart());
  const lm = lastMonthWindow();
  const trendFrom = new Date(dhakaDayStart().getTime() - 29 * DAY_MS);

  const [
    rangeSummary,
    thisMonthSummary,
    lastMonthSummary,
    trendSummary,
    funnelData,
    collection,
    courier,
    stock,
    pkg,
    leaderboard,
    teamGauges,
    whoIsIn,
    leadsDetailed,
    leadsConverted,
    leadsBulk,
    countries,
    expenseReport,
    deliveredAgg,
    draftAgg,
    paymentsByType,
    steadfastIntegration,
  ] = await Promise.all([
    buildDailySummary({ from, to }),
    buildDailySummary({ from: monthStart, to: endToday }),
    buildDailySummary({ from: lm.start, to: lm.end }),
    buildDailySummary({ from: trendFrom, to: endToday }),
    buildFunnel({ createdAt: { gte: from, lte: to } }),
    buildCollectionReport({}), // dues snapshot is range-independent (live)
    buildCourierReport(),
    buildStockReport(opts.showCosts),
    buildPackageReport(opts.showCosts),
    buildLeaderboard(monthKey),
    buildTeamGauges(monthKey, now),
    whoIsInToday(now),
    prisma.lead.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.lead.count({
      where: { createdAt: { gte: from, lte: to }, status: "CONVERTED" },
    }),
    // Bulk daily counts in the window — every lead total combines both entry
    // modes (CORRECTIONS Leads §6). date is @db.Date → Dhaka-day bounds.
    prisma.leadDailyCount.aggregate({
      _sum: { count: true },
      where: { date: { gte: dhakaDateBound(from), lte: dhakaDateBound(to) } },
    }),
    buildCountrySales(from, to),
    opts.showCosts ? buildExpenseReport({ from, to }) : Promise.resolve(null),
    // §3 — Delivered: orders created in range now at DELIVERED/COMPLETED
    // (matches the funnel's delivered stage). Trashed rows auto-excluded (db.ts).
    prisma.order.aggregate({
      where: {
        createdAt: { gte: from, lte: to },
        status: { in: ["DELIVERED", "COMPLETED"] },
      },
      _sum: { totalAmount: true },
      _count: true,
    }),
    // §7 — Draft orders (committed-but-unpaid pipeline) created in range.
    prisma.order.aggregate({
      where: { createdAt: { gte: from, lte: to }, status: "DRAFT" },
      _sum: { totalAmount: true },
      _count: true,
    }),
    // §4/§5 — collections in range split by payment type. Rejected payments and
    // payments on trashed orders stay out (same rule as the collection report).
    prisma.payment.groupBy({
      by: ["type"],
      where: {
        paymentDate: { gte: from, lte: to },
        isRejected: false,
        order: { deletedAt: null },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    // §6 — is the Steadfast integration on? (balance itself is fetched live by
    // the client tile; here we only decide whether it may call out.)
    getSteadfastIntegration(),
  ]);

  // ── CORRECTIONS Dashboard §1–§7 — snapshot KPI strip ──
  const payByType = new Map<string, { amount: number; count: number }>();
  for (const g of paymentsByType) {
    payByType.set(g.type, {
      amount: Number(g._sum.amount ?? 0),
      count: g._count._all,
    });
  }
  const payOf = (t: string) => payByType.get(t) ?? { amount: 0, count: 0 };
  const advanceType = payOf("ADVANCE"); // §4 — ADVANCE only
  const collAdvance = round2(advanceType.amount + payOf("PARTIAL").amount);
  const collCod = round2(payOf("COD_COURIER").amount);
  const collPostMfs = round2(payOf("POST_DELIVERY_MFS").amount);
  // Combined lead total (§1/§6): detailed leads + bulk daily counts.
  const leadsTotal = leadsDetailed + (leadsBulk._sum.count ?? 0);

  const snapshot: DashboardSnapshot = {
    leads: leadsTotal,
    orders: rangeSummary.totals.orders,
    delivered: {
      count: deliveredAgg._count,
      amount: round2(Number(deliveredAgg._sum.totalAmount ?? 0)),
    },
    advanceCollection: {
      count: advanceType.count,
      amount: round2(advanceType.amount),
    },
    collection: {
      advance: collAdvance,
      cod: collCod,
      postMfs: collPostMfs,
      total: round2(collAdvance + collCod + collPostMfs),
    },
    drafts: {
      count: draftAgg._count,
      amount: round2(Number(draftAgg._sum.totalAmount ?? 0)),
    },
    courierEnabled: !!steadfastIntegration?.isEnabled,
  };

  // Row 2 — align this-month and last-month cumulative sales by day-of-month.
  const thisSales = thisMonthSummary.rows.map((r) => r.salesValue);
  const lastSales = lastMonthSummary.rows.map((r) => r.salesValue);
  const dayCount = Math.max(thisSales.length, lastSales.length, 1);
  const labels = Array.from({ length: dayCount }, (_, i) => String(i + 1));
  const pad = (arr: number[]) =>
    Array.from({ length: dayCount }, (_, i) => (i < arr.length ? arr[i] : 0));
  const thisCumulative = cumulative(pad(thisSales));
  const lastCumulative = cumulative(pad(lastSales));
  const dayIdx = Math.max(0, thisMonthSummary.rows.length - 1); // today's index
  const lastMonthToDate = lastCumulative[Math.min(dayIdx, lastCumulative.length - 1)] ?? 0;
  const mtdSales = thisMonthSummary.totals.salesValue;
  const deltaPct =
    lastMonthToDate > 0
      ? Math.round(((mtdSales - lastMonthToDate) / lastMonthToDate) * 1000) / 10
      : null;

  // Row 5 — expense donut: top 6 categories + "Other".
  let expenseSplit: OwnerDashboardData["expenseSplit"] = null;
  if (expenseReport) {
    const top = expenseReport.byCategory.slice(0, 6);
    const restAmount =
      Math.round(
        expenseReport.byCategory.slice(6).reduce((s, r) => s + r.amount, 0) * 100
      ) / 100;
    const slices: ExpenseSlice[] = top.map((c) => ({
      name: c.name,
      amount: c.amount,
      share: c.share,
    }));
    if (restAmount > 0) {
      slices.push({
        name: "Other",
        amount: restAmount,
        share:
          expenseReport.total > 0
            ? Math.round((restAmount / expenseReport.total) * 1000) / 10
            : 0,
      });
    }
    expenseSplit = { total: expenseReport.total, slices };
  }

  const activePackages = pkg.rows.filter((r) => r.isActive);

  return {
    window,
    snapshot,
    money: {
      orders: rangeSummary.totals.orders,
      sales: rangeSummary.totals.salesValue,
      collection: rangeSummary.totals.collection,
      costs: rangeSummary.totals.costs,
      net: rangeSummary.totals.net,
    },
    month: {
      thisLabel: monthLabel(monthKey),
      lastLabel: monthLabel(lm.ym),
      mtdSales,
      mtdNet: thisMonthSummary.totals.net,
      lastMonthSales: lastMonthSummary.totals.salesValue,
      lastMonthToDate,
      deltaPct,
      labels,
      thisCumulative,
      lastCumulative,
    },
    dues: {
      totalOutstanding: collection.dues.totalOutstanding,
      orderCount: collection.dues.orderCount,
    },
    codPending: courier.codPending,
    funnel: funnelData.funnel,
    funnelExtra: funnelData.funnelExtra,
    inventory: {
      stockValue: opts.showCosts ? stock.totalStockValue : null,
      trackedCount: stock.rows.filter((r) => r.isStockTracked).length,
      lowStockCount: stock.lowStockCount,
      packageAlerts: activePackages.filter((r) => r.buildable === 0).length,
      activePackages: activePackages.length,
    },
    leaderboard: leaderboard.slice(0, 6),
    teamGauges,
    leads: {
      // Combined total (§6): detailed leads + bulk daily counts; conversions
      // only exist on detailed leads but the rate reads over all of them.
      total: leadsTotal,
      converted: leadsConverted,
      conversionPct:
        leadsTotal > 0
          ? Math.round((leadsConverted / leadsTotal) * 1000) / 10
          : null,
    },
    whoIsIn,
    trend30: {
      points: trendSummary.rows.map((r) => ({
        date: r.date,
        sales: r.salesValue,
        collection: r.collection,
      })),
      peak: Math.max(
        1,
        ...trendSummary.rows.map((r) => Math.max(r.salesValue, r.collection))
      ),
    },
    expenseSplit,
    countries,
  };
}
