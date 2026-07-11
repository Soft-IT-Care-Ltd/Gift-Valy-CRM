import { prisma } from "@/lib/db";
import type { OrderStatus, Prisma } from "@prisma/client";
import { dhakaDayStart, dhakaMonthStart } from "@/lib/orders";
import {
  NON_SALE_STATUSES,
  type OrderStatusValue,
} from "@/lib/order-constants";

// Report data builders for SPEC §12 Module 10 — R1 (Sales), R11 (Cancelled/
// Returned analysis) and R12 (Customer report). All three aggregate over orders
// and take the caller's `orderScopeWhere` (SE own / TL team / Manager+Admin
// all), so every number is computed inside the viewer's scope. No cost or
// profit fields anywhere here (CLAUDE.md rule 1) — "value" always means the
// customer-facing totalAmount.

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY_MS = 24 * 60 * 60 * 1000;

// An order stops counting as a sale when its money came back or never landed
// (§4.2) — same rule as targets/leaderboard so all screens agree.
const LOST_STATUSES = NON_SALE_STATUSES; // CANCELLED, RETURNED, REFUNDED
const DELIVERED_STATUSES: OrderStatusValue[] = ["DELIVERED", "COMPLETED"];

// YYYY-MM-DD for a Date in Asia/Dhaka (en-CA renders ISO date order).
function dhakaYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// ============ R1 — Sales report (SPEC §4 / §12) ============
// Orders & value by day / SE / team / package / country; delivered vs cancelled.

export interface SalesGroupRow {
  key: string;
  label: string;
  orders: number; // all orders in range, any status
  salesValue: number; // Σ totalAmount excluding cancelled/returned/refunded
  delivered: number; // DELIVERED + COMPLETED count
  cancelled: number; // CANCELLED + RETURNED + REFUNDED count
}

export interface SalesStatusRow {
  status: OrderStatusValue;
  orders: number;
  value: number;
}

export interface SalesPackageRow {
  key: string;
  label: string; // package name (code) or "(custom package)"
  qty: number;
  orders: number; // distinct orders containing the package
  value: number; // Σ line totals
}

export interface SalesReport {
  range: { from: string; to: string };
  totalOrders: number;
  totalValue: number; // Σ totalAmount over ALL orders in range
  salesOrders: number; // excluding lost statuses
  salesValue: number;
  avgOrderValue: number; // salesValue ÷ salesOrders
  delivered: { count: number; value: number };
  cancelled: { count: number; value: number }; // the three lost statuses
  byStatus: SalesStatusRow[];
  byDay: SalesGroupRow[]; // ascending
  bySE: SalesGroupRow[];
  byTeam: SalesGroupRow[];
  byCountry: SalesGroupRow[];
  byPackage: SalesPackageRow[]; // over sale (non-lost) orders only
}

export interface OrderReportFilters {
  from?: Date;
  to?: Date;
  orderWhere: Prisma.OrderWhereInput; // scope (SE own / TL team / all)
  seId?: number;
  teamId?: number;
}

function rangeAnd(opts: OrderReportFilters): {
  from: Date;
  to: Date;
  where: Prisma.OrderWhereInput;
} {
  // Default window = current Dhaka month → end of today (matches R7/R8).
  const from = opts.from ?? dhakaMonthStart();
  const to = opts.to ?? new Date(dhakaDayStart().getTime() + DAY_MS - 1);
  const filters: Prisma.OrderWhereInput[] = [
    opts.orderWhere,
    { createdAt: { gte: from, lte: to } },
  ];
  if (opts.seId) filters.push({ salesExecutiveId: opts.seId });
  if (opts.teamId) filters.push({ teamId: opts.teamId });
  return { from, to, where: { AND: filters } };
}

export async function buildSalesReport(
  opts: OrderReportFilters
): Promise<SalesReport> {
  const { from, to, where } = rangeAnd(opts);

  const orders = await prisma.order.findMany({
    where,
    select: {
      id: true,
      createdAt: true,
      status: true,
      totalAmount: true,
      salesExecutiveId: true,
      salesExecutive: { select: { name: true } },
      teamId: true,
      team: { select: { name: true } },
      customer: { select: { country: true } },
      items: {
        where: { itemType: "PACKAGE" },
        select: {
          packageId: true,
          qty: true,
          lineTotal: true,
          customName: true,
          package: { select: { name: true, code: true } },
        },
      },
    },
  });

  let totalValue = 0;
  let salesOrders = 0;
  let salesValue = 0;
  const delivered = { count: 0, value: 0 };
  const cancelled = { count: 0, value: 0 };
  const byStatus = new Map<OrderStatusValue, SalesStatusRow>();

  const groups = {
    byDay: new Map<string, SalesGroupRow>(),
    bySE: new Map<string, SalesGroupRow>(),
    byTeam: new Map<string, SalesGroupRow>(),
    byCountry: new Map<string, SalesGroupRow>(),
  };
  const byPackage = new Map<string, SalesPackageRow & { orderIds: Set<number> }>();

  const bump = (
    map: Map<string, SalesGroupRow>,
    key: string,
    label: string,
    o: { isLost: boolean; isDelivered: boolean; amount: number }
  ) => {
    const row =
      map.get(key) ??
      { key, label, orders: 0, salesValue: 0, delivered: 0, cancelled: 0 };
    row.orders += 1;
    if (!o.isLost) row.salesValue = round2(row.salesValue + o.amount);
    if (o.isDelivered) row.delivered += 1;
    if (o.isLost) row.cancelled += 1;
    map.set(key, row);
  };

  for (const o of orders) {
    const amount = Number(o.totalAmount);
    const status = o.status as OrderStatusValue;
    const isLost = LOST_STATUSES.includes(status);
    const isDelivered = DELIVERED_STATUSES.includes(status);

    totalValue = round2(totalValue + amount);
    if (!isLost) {
      salesOrders += 1;
      salesValue = round2(salesValue + amount);
    }
    if (isDelivered) {
      delivered.count += 1;
      delivered.value = round2(delivered.value + amount);
    }
    if (isLost) {
      cancelled.count += 1;
      cancelled.value = round2(cancelled.value + amount);
    }

    const st =
      byStatus.get(status) ?? { status, orders: 0, value: 0 };
    st.orders += 1;
    st.value = round2(st.value + amount);
    byStatus.set(status, st);

    const info = { isLost, isDelivered, amount };
    const day = dhakaYmd(o.createdAt);
    bump(groups.byDay, day, day, info);
    bump(groups.bySE, String(o.salesExecutiveId), o.salesExecutive.name, info);
    bump(
      groups.byTeam,
      o.teamId === null ? "none" : String(o.teamId),
      o.team?.name ?? "— No team",
      info
    );
    bump(groups.byCountry, o.customer.country, o.customer.country, info);

    // Packages sold — over sale orders only, so a cancelled order's packages
    // don't inflate "sold" quantities.
    if (!isLost) {
      for (const it of o.items) {
        const key = it.packageId === null ? "custom" : String(it.packageId);
        const label = it.package
          ? `${it.package.name} (${it.package.code})`
          : it.customName
            ? `${it.customName} (custom)`
            : "(custom package)";
        const row =
          byPackage.get(key) ??
          { key, label, qty: 0, orders: 0, value: 0, orderIds: new Set<number>() };
        row.qty += it.qty;
        row.value = round2(row.value + Number(it.lineTotal));
        row.orderIds.add(o.id);
        byPackage.set(key, row);
      }
    }
  }

  const sortByValue = (a: SalesGroupRow, b: SalesGroupRow) =>
    b.salesValue - a.salesValue || b.orders - a.orders;

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    totalOrders: orders.length,
    totalValue,
    salesOrders,
    salesValue,
    avgOrderValue: salesOrders > 0 ? round2(salesValue / salesOrders) : 0,
    delivered,
    cancelled,
    byStatus: [...byStatus.values()].sort((a, b) => b.orders - a.orders),
    byDay: [...groups.byDay.values()].sort((a, b) => a.key.localeCompare(b.key)),
    bySE: [...groups.bySE.values()].sort(sortByValue),
    byTeam: [...groups.byTeam.values()].sort(sortByValue),
    byCountry: [...groups.byCountry.values()].sort(sortByValue),
    byPackage: [...byPackage.values()]
      .map(({ orderIds, ...row }) => ({ ...row, orders: orderIds.size }))
      .sort((a, b) => b.value - a.value),
  };
}

// ============ R11 — Cancelled / Returned analysis (SPEC §12) ============
// Reasons, value lost, SE-wise. Cancels carry a structured cancel_reason;
// courier returns don't have one (the return-approval note is free text), so
// returned/refunded orders fall back to a status label in the reason table.

export interface LostReasonGroupRow {
  reason: string;
  count: number;
  value: number;
  share: number; // % of lost orders
}

export interface LostBySERow {
  key: string;
  label: string;
  totalOrders: number; // everything the SE booked in range
  cancelled: number;
  cancelledValue: number;
  returned: number;
  returnedValue: number;
  refunded: number;
  refundedValue: number;
  lossRatePct: number; // lost ÷ totalOrders
}

export interface LostOrderRow {
  orderId: number;
  orderNo: string;
  createdAt: string; // ISO
  status: OrderStatusValue;
  reason: string;
  customerName: string;
  salesExecutive: string;
  value: number;
}

export interface CancelledReport {
  range: { from: string; to: string };
  totalOrders: number; // all orders in range (loss-rate denominator)
  cancelled: { count: number; value: number };
  returned: { count: number; value: number };
  refunded: { count: number; value: number };
  lostCount: number;
  lostValue: number;
  lossRatePct: number;
  byReason: LostReasonGroupRow[];
  bySE: LostBySERow[];
  rows: LostOrderRow[]; // newest first
}

function lostReasonLabel(o: {
  status: OrderStatusValue;
  cancelReason: string | null;
}): string {
  const reason = o.cancelReason?.trim();
  if (reason) return reason;
  if (o.status === "RETURNED") return "(courier return — no reason recorded)";
  if (o.status === "REFUNDED") return "(refunded — no reason recorded)";
  return "(no reason recorded)";
}

export async function buildCancelledReport(
  opts: OrderReportFilters
): Promise<CancelledReport> {
  const { from, to, where } = rangeAnd(opts);

  const [lost, allBySe] = await Promise.all([
    prisma.order.findMany({
      where: {
        AND: [
          where,
          { status: { in: LOST_STATUSES as unknown as OrderStatus[] } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderNo: true,
        createdAt: true,
        status: true,
        cancelReason: true,
        totalAmount: true,
        salesExecutiveId: true,
        salesExecutive: { select: { name: true } },
        customer: { select: { name: true } },
      },
    }),
    // Denominators: every order each SE booked in the range, any status.
    prisma.order.groupBy({
      by: ["salesExecutiveId"],
      where,
      _count: { _all: true },
    }),
  ]);

  const seNames = new Map<number, string>();
  const totals = { cancelled: { count: 0, value: 0 }, returned: { count: 0, value: 0 }, refunded: { count: 0, value: 0 } };
  const byReason = new Map<string, LostReasonGroupRow>();
  const bySE = new Map<number, LostBySERow>();
  const rows: LostOrderRow[] = [];

  for (const o of lost) {
    const status = o.status as OrderStatusValue;
    const value = Number(o.totalAmount);
    const bucket =
      status === "CANCELLED"
        ? totals.cancelled
        : status === "RETURNED"
          ? totals.returned
          : totals.refunded;
    bucket.count += 1;
    bucket.value = round2(bucket.value + value);

    const reason = lostReasonLabel({ status, cancelReason: o.cancelReason });
    const r =
      byReason.get(reason) ?? { reason, count: 0, value: 0, share: 0 };
    r.count += 1;
    r.value = round2(r.value + value);
    byReason.set(reason, r);

    seNames.set(o.salesExecutiveId, o.salesExecutive.name);
    const se =
      bySE.get(o.salesExecutiveId) ??
      {
        key: String(o.salesExecutiveId),
        label: o.salesExecutive.name,
        totalOrders: 0,
        cancelled: 0,
        cancelledValue: 0,
        returned: 0,
        returnedValue: 0,
        refunded: 0,
        refundedValue: 0,
        lossRatePct: 0,
      };
    if (status === "CANCELLED") {
      se.cancelled += 1;
      se.cancelledValue = round2(se.cancelledValue + value);
    } else if (status === "RETURNED") {
      se.returned += 1;
      se.returnedValue = round2(se.returnedValue + value);
    } else {
      se.refunded += 1;
      se.refundedValue = round2(se.refundedValue + value);
    }
    bySE.set(o.salesExecutiveId, se);

    rows.push({
      orderId: o.id,
      orderNo: o.orderNo,
      createdAt: o.createdAt.toISOString(),
      status,
      reason,
      customerName: o.customer.name,
      salesExecutive: o.salesExecutive.name,
      value,
    });
  }

  const totalOrders = allBySe.reduce((s, g) => s + g._count._all, 0);
  for (const g of allBySe) {
    const se = bySE.get(g.salesExecutiveId);
    if (se) {
      se.totalOrders = g._count._all;
      const lostN = se.cancelled + se.returned + se.refunded;
      se.lossRatePct =
        se.totalOrders > 0 ? round2((lostN / se.totalOrders) * 100) : 0;
    }
  }

  const lostCount = lost.length;
  const lostValue = round2(
    totals.cancelled.value + totals.returned.value + totals.refunded.value
  );

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    totalOrders,
    cancelled: totals.cancelled,
    returned: totals.returned,
    refunded: totals.refunded,
    lostCount,
    lostValue,
    lossRatePct: totalOrders > 0 ? round2((lostCount / totalOrders) * 100) : 0,
    byReason: [...byReason.values()]
      .map((r) => ({
        ...r,
        share: lostCount > 0 ? round2((r.count / lostCount) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count),
    bySE: [...bySE.values()].sort(
      (a, b) =>
        b.cancelledValue + b.returnedValue + b.refundedValue -
        (a.cancelledValue + a.returnedValue + a.refundedValue)
    ),
    rows,
  };
}

// ============ R12 — Customer report (SPEC §4.1 / §12) ============
// Repeat customers, top customers, per-country sales. phone_foreign is the
// repeat-customer key (§4.1 A), so grouping is by customer row. Defaults to
// ALL TIME — "repeat" and "top" are lifetime notions; the range filter narrows
// which orders are considered when set.

export interface CustomerRow {
  customerId: number;
  name: string;
  phoneForeign: string;
  country: string;
  orders: number; // all orders, any status
  saleOrders: number; // excluding lost statuses — the repeat/top metric
  salesValue: number;
  firstOrderAt: string; // ISO
  lastOrderAt: string; // ISO
}

export interface CustomerCountryRow {
  country: string;
  customers: number;
  saleOrders: number;
  salesValue: number;
}

export interface CustomerReport {
  range: { from: string | null; to: string | null }; // null = all time
  totalCustomers: number; // customers with ≥1 order in scope/range
  repeatCustomers: number; // ≥2 sale orders
  repeatRatePct: number;
  totalSalesValue: number;
  avgValuePerCustomer: number;
  topCustomers: CustomerRow[]; // top 50 by sales value
  repeatRows: CustomerRow[]; // all repeat customers, most orders first
  byCountry: CustomerCountryRow[];
}

const TOP_CUSTOMER_LIMIT = 50;

export async function buildCustomerReport(opts: {
  from?: Date;
  to?: Date;
  orderWhere: Prisma.OrderWhereInput;
}): Promise<CustomerReport> {
  const filters: Prisma.OrderWhereInput[] = [opts.orderWhere];
  if (opts.from || opts.to) {
    filters.push({
      createdAt: {
        ...(opts.from ? { gte: opts.from } : {}),
        ...(opts.to ? { lte: opts.to } : {}),
      },
    });
  }

  const orders = await prisma.order.findMany({
    where: { AND: filters },
    select: {
      customerId: true,
      createdAt: true,
      status: true,
      totalAmount: true,
      customer: {
        select: { name: true, phoneForeign: true, country: true },
      },
    },
  });

  const byCustomer = new Map<number, CustomerRow>();
  for (const o of orders) {
    const isLost = LOST_STATUSES.includes(o.status as OrderStatusValue);
    const at = o.createdAt.toISOString();
    const row =
      byCustomer.get(o.customerId) ??
      {
        customerId: o.customerId,
        name: o.customer.name,
        phoneForeign: o.customer.phoneForeign,
        country: o.customer.country,
        orders: 0,
        saleOrders: 0,
        salesValue: 0,
        firstOrderAt: at,
        lastOrderAt: at,
      };
    row.orders += 1;
    if (!isLost) {
      row.saleOrders += 1;
      row.salesValue = round2(row.salesValue + Number(o.totalAmount));
    }
    if (at < row.firstOrderAt) row.firstOrderAt = at;
    if (at > row.lastOrderAt) row.lastOrderAt = at;
    byCustomer.set(o.customerId, row);
  }

  const customers = [...byCustomer.values()];
  const repeat = customers.filter((c) => c.saleOrders >= 2);
  const totalSalesValue = round2(
    customers.reduce((s, c) => s + c.salesValue, 0)
  );

  const byCountry = new Map<string, CustomerCountryRow>();
  for (const c of customers) {
    const row =
      byCountry.get(c.country) ??
      { country: c.country, customers: 0, saleOrders: 0, salesValue: 0 };
    row.customers += 1;
    row.saleOrders += c.saleOrders;
    row.salesValue = round2(row.salesValue + c.salesValue);
    byCountry.set(c.country, row);
  }

  return {
    range: {
      from: opts.from ? opts.from.toISOString() : null,
      to: opts.to ? opts.to.toISOString() : null,
    },
    totalCustomers: customers.length,
    repeatCustomers: repeat.length,
    repeatRatePct:
      customers.length > 0
        ? round2((repeat.length / customers.length) * 100)
        : 0,
    totalSalesValue,
    avgValuePerCustomer:
      customers.length > 0 ? round2(totalSalesValue / customers.length) : 0,
    topCustomers: [...customers]
      .sort((a, b) => b.salesValue - a.salesValue || b.saleOrders - a.saleOrders)
      .slice(0, TOP_CUSTOMER_LIMIT),
    repeatRows: repeat.sort(
      (a, b) => b.saleOrders - a.saleOrders || b.salesValue - a.salesValue
    ),
    byCountry: [...byCountry.values()].sort(
      (a, b) => b.salesValue - a.salesValue
    ),
  };
}
