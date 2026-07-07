import type { Prisma } from "@prisma/client";

// SPEC §6.1/§6.2 + CLAUDE.md rule 1: cost & margin fields are stripped in the
// service layer for anyone without these permissions — Sales Executives (and
// Packing/TeamLeader) must never receive them in any API response.
export function canSeeCosts(permissions: string[]): boolean {
  return (
    permissions.includes("catalog.manage") ||
    permissions.includes("reports.pnl")
  );
}

// SKU/code derive from the row id inside the create transaction — unique
// without a counter table.
export function skuFromId(id: number): string {
  return `GV-${String(id).padStart(4, "0")}`;
}

export function packageCodeFromId(id: number): string {
  return `PKG-${String(id).padStart(3, "0")}`;
}

export type ProductWithCategory = Prisma.ProductGetPayload<{
  include: { category: true };
}>;

export type PackageWithItems = Prisma.PackageGetPayload<{
  include: { items: { include: { product: true } } };
}>;

export function serializeProduct(p: ProductWithCategory, showCosts: boolean) {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    categoryId: p.categoryId,
    categoryName: p.category.name,
    photoUrl: p.photoUrl,
    unit: p.unit,
    sellingPrice: Number(p.sellingPrice),
    priceFloor: Number(p.priceFloor),
    lowStockThreshold: p.lowStockThreshold,
    isStockTracked: p.isStockTracked,
    isActive: p.isActive,
    stockQty: p.stockQty,
    ...(showCosts ? { avgCost: Number(p.avgCost) } : {}),
  };
}

// Package cost = Σ(component avg cost × qty) — auto-computed, never stored.
export function packageCost(pkg: PackageWithItems): number {
  return pkg.items.reduce(
    (sum, it) => sum + it.qty * Number(it.product.avgCost),
    0
  );
}

// Available-to-sell = min over stock-tracked components of ⌊stock ÷ qty⌋.
// Non-stock-tracked components (perishables, bought per order) don't
// constrain it; null = unconstrained (every component is per-order).
export function packageAvailable(pkg: PackageWithItems): number | null {
  const tracked = pkg.items.filter((it) => it.product.isStockTracked);
  if (tracked.length === 0) return null;
  return Math.min(
    ...tracked.map((it) => Math.floor(it.product.stockQty / it.qty))
  );
}

export function serializePackage(pkg: PackageWithItems, showCosts: boolean) {
  const cost = packageCost(pkg);
  return {
    id: pkg.id,
    code: pkg.code,
    name: pkg.name,
    photoUrl: pkg.photoUrl,
    sellingPrice: Number(pkg.sellingPrice),
    priceFloor: Number(pkg.priceFloor),
    isActive: pkg.isActive,
    availableToSell: packageAvailable(pkg),
    items: pkg.items.map((it) => ({
      id: it.id,
      productId: it.productId,
      productName: it.product.name,
      sku: it.product.sku,
      unit: it.product.unit,
      qty: it.qty,
      isStockTracked: it.product.isStockTracked,
      stockQty: it.product.stockQty,
      ...(showCosts ? { unitCost: Number(it.product.avgCost) } : {}),
    })),
    ...(showCosts
      ? { cost, margin: Number(pkg.sellingPrice) - cost }
      : {}),
  };
}
