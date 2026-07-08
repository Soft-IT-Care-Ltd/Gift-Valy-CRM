import { prisma } from "@/lib/db";
import { packageAvailable, packageCost } from "@/lib/catalog";
import { dhakaDayStart, dhakaMonthStart } from "@/lib/orders";
import type {
  PaymentMethodValue,
  PaymentTypeValue,
} from "@/lib/order-constants";
import type { WalletTypeValue } from "@/lib/wallet";

// Report data builders for SPEC §12 Module 10 — R4 (Stock) and R5 (Package
// availability). Cost/value fields (avg cost, stock value, package cost/margin)
// are populated only when `showCosts` is true; callers pass canSeeCosts() so the
// numbers never reach a cost-blind role (CLAUDE.md rule 1). Row types live here
// and are consumed by the client components via `import type` (erased at build,
// so no server code crosses into the client bundle).

const round2 = (n: number) => Math.round(n * 100) / 100;

// ============ R4 — Stock report (SPEC §6.3) ============

export interface StockReportRow {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  isStockTracked: boolean;
  isActive: boolean;
  stockQty: number; // physical on-hand
  reservedQty: number; // held by CONFIRMED orders
  available: number; // on-hand − reserved
  lowStockThreshold: number;
  isLow: boolean; // active, tracked, and available ≤ threshold
  avgCost?: number; // cost-visible roles only
  stockValue?: number; // qty × avg cost, cost-visible roles only
}

export interface StockReport {
  rows: StockReportRow[];
  totalStockValue: number | null; // Σ stockValue over tracked products; null when cost-blind
  lowStockCount: number;
}

// Low-stock rule matches the Stock screen and owner dashboard: available at or
// below the threshold, only for active stock-tracked products (SPEC §6.1).
function isLowStock(p: {
  isStockTracked: boolean;
  isActive: boolean;
  available: number;
  lowStockThreshold: number;
}): boolean {
  return (
    p.isStockTracked && p.isActive && p.available <= p.lowStockThreshold
  );
}

export async function buildStockReport(showCosts: boolean): Promise<StockReport> {
  const products = await prisma.product.findMany({
    orderBy: { name: "asc" },
    include: { category: { select: { name: true } } },
  });

  const rows: StockReportRow[] = products.map((p) => {
    const available = p.stockQty - p.reservedQty;
    const base = {
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category.name,
      unit: p.unit,
      isStockTracked: p.isStockTracked,
      isActive: p.isActive,
      stockQty: p.stockQty,
      reservedQty: p.reservedQty,
      available,
      lowStockThreshold: p.lowStockThreshold,
    };
    return {
      ...base,
      isLow: isLowStock(base),
      ...(showCosts
        ? {
            avgCost: Number(p.avgCost),
            // Value is on physical on-hand, and only for tracked products
            // (a per-order product carries no standing stock value).
            stockValue: p.isStockTracked
              ? round2(p.stockQty * Number(p.avgCost))
              : 0,
          }
        : {}),
    };
  });

  const totalStockValue = showCosts
    ? round2(rows.reduce((s, r) => s + (r.stockValue ?? 0), 0))
    : null;
  const lowStockCount = rows.filter((r) => r.isLow).length;

  return { rows, totalStockValue, lowStockCount };
}

// ============ R5 — Package availability (SPEC §6.2) ============

export interface PackageComponentRow {
  productName: string;
  sku: string;
  unit: string;
  qtyPerPackage: number;
  isStockTracked: boolean;
  stockQty: number;
  buildableFrom: number | null; // ⌊stock ÷ qty⌋; null for per-order components
}

export interface PackageReportRow {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
  sellingPrice: number;
  componentCount: number;
  buildable: number | null; // min over tracked components; null = unconstrained (all per-order)
  limitedBy: string | null; // component name(s) at the binding minimum
  cost?: number; // cost-visible roles only
  margin?: number; // cost-visible roles only
  components: PackageComponentRow[];
}

export interface PackageReport {
  rows: PackageReportRow[];
}

export async function buildPackageReport(
  showCosts: boolean
): Promise<PackageReport> {
  const packages = await prisma.package.findMany({
    orderBy: { name: "asc" },
    include: {
      items: {
        include: { product: true },
        orderBy: { id: "asc" },
      },
    },
  });

  const rows: PackageReportRow[] = packages.map((pkg) => {
    const buildable = packageAvailable(pkg); // number | null (SPEC §6.2)

    const components: PackageComponentRow[] = pkg.items.map((it) => ({
      productName: it.product.name,
      sku: it.product.sku,
      unit: it.product.unit,
      qtyPerPackage: it.qty,
      isStockTracked: it.product.isStockTracked,
      stockQty: it.product.stockQty,
      buildableFrom: it.product.isStockTracked
        ? Math.floor(it.product.stockQty / it.qty)
        : null,
    }));

    // The binding constraint(s): tracked components whose per-component cap
    // equals the package's buildable qty — what to restock to make more.
    let limitedBy: string | null = null;
    if (buildable !== null) {
      const binding = components
        .filter((c) => c.buildableFrom === buildable)
        .map((c) => c.productName);
      limitedBy = binding.length > 0 ? binding.join(", ") : null;
    }

    const cost = showCosts ? round2(packageCost(pkg)) : undefined;
    return {
      id: pkg.id,
      code: pkg.code,
      name: pkg.name,
      isActive: pkg.isActive,
      sellingPrice: Number(pkg.sellingPrice),
      componentCount: pkg.items.length,
      buildable,
      limitedBy,
      ...(showCosts
        ? { cost, margin: round2(Number(pkg.sellingPrice) - (cost ?? 0)) }
        : {}),
      components,
    };
  });

  return { rows };
}

// ============ R6 — Courier report (SPEC §7 / §12) ============
// Operational, not costing: pending handover, in-transit, delivered %,
// returned %, and COD pending with courier (order-wise, aging). Visible to
// courier.manage roles (Admin, Manager, Accounts) — no cost fields.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CourierPendingHandoverRow {
  orderId: number;
  orderNo: string;
  recipientName: string;
  district: string;
  packedAt: string | null; // ISO — when the order was marked PACKED
  ageDays: number; // days waiting for handover
  codAmount: number;
  salesExecutive: string;
}

export interface CourierCodPendingRow {
  shipmentId: number;
  orderId: number;
  orderNo: string;
  courier: string;
  recipientName: string;
  district: string;
  deliveredAt: string | null; // ISO
  codAmount: number;
  ageDays: number; // since delivery — the aging metric (SPEC §7)
}

export interface CourierPerCompanyRow {
  courierId: number;
  name: string;
  handedToCourier: number;
  inTransit: number;
  delivered: number;
  returned: number;
  total: number;
  codPendingCount: number;
  codPendingAmount: number;
}

// Shipments the courier integration flagged for a human (STEADFAST_INTEGRATION.md
// §3B): on_hold or needs_attention (partial / unknown status).
export interface CourierAttentionRow {
  shipmentId: number;
  orderId: number;
  orderNo: string;
  courier: string;
  recipientName: string;
  district: string;
  status: string;
  steadfastStatus: string | null;
  onHold: boolean;
  needsAttention: boolean;
}

export interface CourierReport {
  pendingHandoverCount: number;
  counts: {
    handedToCourier: number;
    inTransit: number;
    delivered: number;
    returned: number;
    total: number; // all shipments ever dispatched
  };
  deliveredPct: number; // delivered ÷ total dispatched
  returnedPct: number; // returned ÷ total dispatched
  codPending: { count: number; amount: number };
  pendingHandoverRows: CourierPendingHandoverRow[];
  codPendingRows: CourierCodPendingRow[];
  attentionRows: CourierAttentionRow[]; // ⚠ on-hold / needs-attention (§3B)
  byCourier: CourierPerCompanyRow[];
}

export async function buildCourierReport(): Promise<CourierReport> {
  const now = Date.now();
  const ageInDays = (from: Date | null) =>
    from ? Math.max(0, Math.floor((now - from.getTime()) / DAY_MS)) : 0;

  const [pendingHandover, shipments, couriers] = await Promise.all([
    // PACKED orders with no shipment yet = awaiting handover (SPEC §7).
    prisma.order.findMany({
      where: { status: "PACKED", shipment: { is: null } },
      orderBy: { createdAt: "asc" },
      include: {
        salesExecutive: { select: { name: true } },
        statusHistory: {
          where: { toStatus: "PACKED" },
          orderBy: { at: "desc" },
          take: 1,
          select: { at: true },
        },
      },
    }),
    prisma.shipment.findMany({
      include: {
        courier: { select: { id: true, name: true } },
        order: { select: { id: true, orderNo: true, recipientName: true, district: true } },
      },
    }),
    prisma.courier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const counts = {
    handedToCourier: 0,
    inTransit: 0,
    delivered: 0,
    returned: 0,
    total: shipments.length,
  };
  const perCourier = new Map<number, CourierPerCompanyRow>();
  for (const c of couriers) {
    perCourier.set(c.id, {
      courierId: c.id,
      name: c.name,
      handedToCourier: 0,
      inTransit: 0,
      delivered: 0,
      returned: 0,
      total: 0,
      codPendingCount: 0,
      codPendingAmount: 0,
    });
  }
  const ensureRow = (id: number, name: string) => {
    let row = perCourier.get(id);
    if (!row) {
      row = {
        courierId: id,
        name,
        handedToCourier: 0,
        inTransit: 0,
        delivered: 0,
        returned: 0,
        total: 0,
        codPendingCount: 0,
        codPendingAmount: 0,
      };
      perCourier.set(id, row);
    }
    return row;
  };

  const codPendingRows: CourierCodPendingRow[] = [];
  const attentionRows: CourierAttentionRow[] = [];
  for (const s of shipments) {
    const row = ensureRow(s.courier.id, s.courier.name);
    row.total += 1;

    // ⚠ integration flags (§3B) — surface anything held or needing review.
    if (s.onHold || s.needsAttention) {
      attentionRows.push({
        shipmentId: s.id,
        orderId: s.order.id,
        orderNo: s.order.orderNo,
        courier: s.courier.name,
        recipientName: s.order.recipientName,
        district: s.order.district,
        status: s.status,
        steadfastStatus: s.steadfastStatus,
        onHold: s.onHold,
        needsAttention: s.needsAttention,
      });
    }
    if (s.status === "HANDED_TO_COURIER") {
      counts.handedToCourier += 1;
      row.handedToCourier += 1;
    } else if (s.status === "IN_TRANSIT") {
      counts.inTransit += 1;
      row.inTransit += 1;
    } else if (s.status === "DELIVERED") {
      counts.delivered += 1;
      row.delivered += 1;
    } else if (s.status === "RETURNED") {
      counts.returned += 1;
      row.returned += 1;
    }

    // COD pending with courier = delivered, has a COD amount, not yet received.
    const cod = Number(s.codAmount);
    if (s.status === "DELIVERED" && cod > 0 && !s.codReceived) {
      row.codPendingCount += 1;
      row.codPendingAmount = round2(row.codPendingAmount + cod);
      codPendingRows.push({
        shipmentId: s.id,
        orderId: s.order.id,
        orderNo: s.order.orderNo,
        courier: s.courier.name,
        recipientName: s.order.recipientName,
        district: s.order.district,
        deliveredAt: s.deliveredAt ? s.deliveredAt.toISOString() : null,
        codAmount: cod,
        ageDays: ageInDays(s.deliveredAt ?? s.handoverDate),
      });
    }
  }
  codPendingRows.sort((a, b) => b.ageDays - a.ageDays); // oldest first (SPEC §7 aging)

  const pendingHandoverRows: CourierPendingHandoverRow[] = pendingHandover.map((o) => {
    const packedAt = o.statusHistory[0]?.at ?? null;
    return {
      orderId: o.id,
      orderNo: o.orderNo,
      recipientName: o.recipientName,
      district: o.district,
      packedAt: packedAt ? packedAt.toISOString() : null,
      ageDays: ageInDays(packedAt),
      codAmount: Number(o.codAmount),
      salesExecutive: o.salesExecutive.name,
    };
  });

  const codPending = {
    count: codPendingRows.length,
    amount: round2(codPendingRows.reduce((s, r) => s + r.codAmount, 0)),
  };

  const pct = (n: number) =>
    counts.total > 0 ? round2((n / counts.total) * 100) : 0;

  return {
    pendingHandoverCount: pendingHandoverRows.length,
    counts,
    deliveredPct: pct(counts.delivered),
    returnedPct: pct(counts.returned),
    codPending,
    pendingHandoverRows,
    codPendingRows,
    attentionRows,
    byCourier: [...perCourier.values()].sort((a, b) => b.total - a.total),
  };
}

// ============ R7 — Collection report (SPEC §8 / §12) ============
// By date range: total collected, by method, by wallet, verified vs unverified,
// plus total dues outstanding with an order-wise aging list. Not a costing
// report — visible to payments.verify roles (Accounts, Manager, Admin).
// REFUND payments are money OUT: they reduce net collection and never count as
// "collected". Dues outstanding is a live snapshot, independent of the range.

export interface CollectionPaymentRow {
  id: number;
  paymentDate: string; // ISO
  orderId: number;
  orderNo: string;
  customerName: string;
  type: PaymentTypeValue;
  method: PaymentMethodValue;
  walletId: number | null;
  walletName: string | null;
  amount: number; // positive; REFUND rows are money out (flagged by type)
  isVerified: boolean;
  transactionId: string | null;
}

export interface CollectionByMethodRow {
  method: PaymentMethodValue;
  collected: number; // non-refund inflow
  refunded: number; // refund outflow
  net: number; // collected − refunded
  count: number; // payment rows (all types)
}

export interface CollectionByWalletRow {
  walletId: number | null; // null = unassigned (e.g. un-remitted courier COD)
  walletName: string; // "— Unassigned" for null
  walletType: WalletTypeValue | null;
  collected: number;
  refunded: number;
  net: number;
  count: number;
}

export interface DueAgingRow {
  orderId: number;
  orderNo: string;
  customerName: string;
  salesExecutive: string;
  status: string;
  createdAt: string; // ISO
  totalAmount: number;
  paid: number; // total − due
  dueAmount: number;
  ageDays: number; // since order creation
  bucket: string; // aging band label
}

export interface CollectionReport {
  range: { from: string; to: string }; // ISO bounds actually applied
  totalCollected: number; // Σ non-refund amounts in range
  totalRefunded: number; // Σ refund amounts in range
  netCollected: number; // collected − refunded
  paymentCount: number; // all payment rows in range (excludes rejected)
  verified: { amount: number; count: number }; // over non-refund inflow
  unverified: { amount: number; count: number };
  rejected: { amount: number; count: number }; // not received — excluded from totals
  byMethod: CollectionByMethodRow[];
  byWallet: CollectionByWalletRow[];
  payments: CollectionPaymentRow[]; // detail rows, newest first
  dues: {
    totalOutstanding: number;
    orderCount: number;
    buckets: { label: string; count: number; amount: number }[];
    rows: DueAgingRow[]; // oldest first
  };
}

const DUE_BUCKETS: { label: string; max: number }[] = [
  { label: "0–7 days", max: 7 },
  { label: "8–15 days", max: 15 },
  { label: "16–30 days", max: 30 },
  { label: "31+ days", max: Infinity },
];

function dueBucket(ageDays: number): string {
  return (DUE_BUCKETS.find((b) => ageDays <= b.max) ?? DUE_BUCKETS.at(-1)!).label;
}

export async function buildCollectionReport(opts: {
  from?: Date;
  to?: Date;
}): Promise<CollectionReport> {
  // Default window = current Dhaka month → end of today (Asia/Dhaka).
  const from = opts.from ?? dhakaMonthStart();
  const to =
    opts.to ?? new Date(dhakaDayStart().getTime() + DAY_MS - 1); // 23:59:59.999 today
  const now = Date.now();

  const [payments, dueOrders, rejectedAgg] = await Promise.all([
    // Rejected payments (money never received) are excluded from collections.
    prisma.payment.findMany({
      where: { paymentDate: { gte: from, lte: to }, isRejected: false },
      orderBy: { paymentDate: "desc" },
      include: {
        wallet: { select: { id: true, name: true, type: true } },
        order: {
          select: {
            id: true,
            orderNo: true,
            customer: { select: { name: true } },
          },
        },
      },
    }),
    // Live dues snapshot — outstanding on any order still owing, excluding
    // cancelled/refunded (those carry no collectable due).
    prisma.order.findMany({
      where: {
        dueAmount: { gt: 0 },
        status: { notIn: ["CANCELLED", "REFUNDED"] },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        orderNo: true,
        status: true,
        createdAt: true,
        totalAmount: true,
        dueAmount: true,
        customer: { select: { name: true } },
        salesExecutive: { select: { name: true } },
      },
    }),
    // Rejected in-range, for transparency (shown as a KPI, not counted).
    prisma.payment.aggregate({
      where: { paymentDate: { gte: from, lte: to }, isRejected: true },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  const rows: CollectionPaymentRow[] = [];
  const byMethod = new Map<PaymentMethodValue, CollectionByMethodRow>();
  const byWallet = new Map<string, CollectionByWalletRow>();
  let totalCollected = 0;
  let totalRefunded = 0;
  let verifiedAmount = 0;
  let verifiedCount = 0;
  let unverifiedAmount = 0;
  let unverifiedCount = 0;

  for (const p of payments) {
    const amount = Number(p.amount);
    const isRefund = p.type === "REFUND";
    const method = p.method as PaymentMethodValue;

    rows.push({
      id: p.id,
      paymentDate: p.paymentDate.toISOString(),
      orderId: p.order.id,
      orderNo: p.order.orderNo,
      customerName: p.order.customer.name,
      type: p.type as PaymentTypeValue,
      method,
      walletId: p.walletId,
      walletName: p.wallet?.name ?? null,
      amount,
      isVerified: p.isVerified,
      transactionId: p.transactionId,
    });

    if (isRefund) totalRefunded = round2(totalRefunded + amount);
    else {
      totalCollected = round2(totalCollected + amount);
      // Verified split is about collected inflow (what Accounts signs off).
      if (p.isVerified) {
        verifiedAmount = round2(verifiedAmount + amount);
        verifiedCount += 1;
      } else {
        unverifiedAmount = round2(unverifiedAmount + amount);
        unverifiedCount += 1;
      }
    }

    const m = byMethod.get(method) ?? {
      method,
      collected: 0,
      refunded: 0,
      net: 0,
      count: 0,
    };
    if (isRefund) m.refunded = round2(m.refunded + amount);
    else m.collected = round2(m.collected + amount);
    m.net = round2(m.collected - m.refunded);
    m.count += 1;
    byMethod.set(method, m);

    const wkey = p.walletId === null ? "none" : String(p.walletId);
    const w = byWallet.get(wkey) ?? {
      walletId: p.walletId,
      walletName: p.wallet?.name ?? "— Unassigned",
      walletType: (p.wallet?.type as WalletTypeValue | undefined) ?? null,
      collected: 0,
      refunded: 0,
      net: 0,
      count: 0,
    };
    if (isRefund) w.refunded = round2(w.refunded + amount);
    else w.collected = round2(w.collected + amount);
    w.net = round2(w.collected - w.refunded);
    w.count += 1;
    byWallet.set(wkey, w);
  }

  const dueRows: DueAgingRow[] = dueOrders.map((o) => {
    const ageDays = Math.max(
      0,
      Math.floor((now - o.createdAt.getTime()) / DAY_MS)
    );
    const total = Number(o.totalAmount);
    const due = Number(o.dueAmount);
    return {
      orderId: o.id,
      orderNo: o.orderNo,
      customerName: o.customer.name,
      salesExecutive: o.salesExecutive.name,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
      totalAmount: total,
      paid: round2(total - due),
      dueAmount: due,
      ageDays,
      bucket: dueBucket(ageDays),
    };
  });
  dueRows.sort((a, b) => b.ageDays - a.ageDays); // oldest first

  const buckets = DUE_BUCKETS.map((b) => {
    const inBucket = dueRows.filter((r) => r.bucket === b.label);
    return {
      label: b.label,
      count: inBucket.length,
      amount: round2(inBucket.reduce((s, r) => s + r.dueAmount, 0)),
    };
  });

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    totalCollected,
    totalRefunded,
    netCollected: round2(totalCollected - totalRefunded),
    paymentCount: rows.length,
    verified: { amount: verifiedAmount, count: verifiedCount },
    unverified: { amount: unverifiedAmount, count: unverifiedCount },
    rejected: {
      amount: round2(Number(rejectedAgg._sum.amount ?? 0)),
      count: rejectedAgg._count,
    },
    byMethod: [...byMethod.values()].sort((a, b) => b.net - a.net),
    byWallet: [...byWallet.values()].sort((a, b) => b.net - a.net),
    payments: rows,
    dues: {
      totalOutstanding: round2(dueRows.reduce((s, r) => s + r.dueAmount, 0)),
      orderCount: dueRows.length,
      buckets,
      rows: dueRows,
    },
  };
}

// ============ Per-wallet running balance (SPEC §9.3) ============
// balance = collections in − (refunds + expenses) out, over all time. Every
// active wallet is listed even at zero; inactive wallets appear only if they
// still carry a non-zero balance (money to move out before retiring them).

export interface WalletBalanceRow {
  walletId: number;
  name: string;
  type: WalletTypeValue;
  isActive: boolean;
  collectionsIn: number; // Σ non-refund payments received
  refundsOut: number; // Σ refund payments paid back
  expensesOut: number; // Σ expenses paid from this wallet
  balance: number; // collectionsIn − refundsOut − expensesOut
}

export interface WalletBalances {
  rows: WalletBalanceRow[];
  totalBalance: number;
  // Collected COD (or other) not yet attributed to a wallet — money that exists
  // but has no running balance until it is assigned.
  unassignedCollected: number;
}

export async function buildWalletBalances(): Promise<WalletBalances> {
  const [wallets, payAgg, refundAgg, expenseAgg, unassignedAgg] =
    await Promise.all([
      prisma.wallet.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
      // Inflow: everything except refunds, grouped by wallet.
      prisma.payment.groupBy({
        by: ["walletId"],
        where: { walletId: { not: null }, type: { not: "REFUND" } },
        _sum: { amount: true },
      }),
      prisma.payment.groupBy({
        by: ["walletId"],
        where: { walletId: { not: null }, type: "REFUND" },
        _sum: { amount: true },
      }),
      prisma.expense.groupBy({
        by: ["walletId"],
        where: { walletId: { not: null } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { walletId: null, type: { not: "REFUND" } },
        _sum: { amount: true },
      }),
    ]);

  const inflow = new Map(payAgg.map((r) => [r.walletId!, Number(r._sum.amount ?? 0)]));
  const refunds = new Map(
    refundAgg.map((r) => [r.walletId!, Number(r._sum.amount ?? 0)])
  );
  const expenses = new Map(
    expenseAgg.map((r) => [r.walletId!, Number(r._sum.amount ?? 0)])
  );

  const rows: WalletBalanceRow[] = [];
  for (const w of wallets) {
    const collectionsIn = round2(inflow.get(w.id) ?? 0);
    const refundsOut = round2(refunds.get(w.id) ?? 0);
    const expensesOut = round2(expenses.get(w.id) ?? 0);
    const balance = round2(collectionsIn - refundsOut - expensesOut);
    // Skip inactive wallets that are fully drained — keeps the list to what matters.
    if (!w.isActive && collectionsIn === 0 && refundsOut === 0 && expensesOut === 0) {
      continue;
    }
    rows.push({
      walletId: w.id,
      name: w.name,
      type: w.type as WalletTypeValue,
      isActive: w.isActive,
      collectionsIn,
      refundsOut,
      expensesOut,
      balance,
    });
  }

  return {
    rows,
    totalBalance: round2(rows.reduce((s, r) => s + r.balance, 0)),
    unassignedCollected: round2(Number(unassignedAgg._sum.amount ?? 0)),
  };
}
