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
