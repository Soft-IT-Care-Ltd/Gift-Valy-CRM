import { prisma } from "@/lib/db";
import { packageAvailable, packageCost } from "@/lib/catalog";

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
