import type { Prisma } from "@prisma/client";
import {
  BomError,
  collectChoiceGroups,
  packageAvailability,
  packageCost,
  packageWeightKg,
  productAvailability,
  productEffectiveCost,
  productWeightKg,
  explodePackage,
  type BomCatalog,
} from "./bom";

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

export type ProductWithRelations = Prisma.ProductGetPayload<{
  include: {
    category: true;
    components: { include: { component: true } };
  };
}>;

export type PackageWithItems = Prisma.PackageGetPayload<{
  include: {
    items: {
      include: {
        product: true;
        childPackage: true;
        options: { include: { product: true } };
      };
    };
  };
}>;

export const productSerializeInclude = {
  category: true,
  components: { include: { component: true }, orderBy: { id: "asc" as const } },
} satisfies Prisma.ProductInclude;

export const packageSerializeInclude = {
  items: {
    include: {
      product: true,
      childPackage: true,
      options: { include: { product: true }, orderBy: { id: "asc" as const } },
    },
    orderBy: { id: "asc" as const },
  },
} satisfies Prisma.PackageInclude;

export function serializeProduct(
  p: ProductWithRelations,
  catalog: BomCatalog,
  showCosts: boolean
) {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    productType: p.productType,
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
    weightKg: p.weightKg == null ? null : Number(p.weightKg),
    deliveryChargeInsideDhaka: Number(p.deliveryChargeInsideDhaka),
    deliveryChargeSubDhaka: Number(p.deliveryChargeSubDhaka),
    deliveryChargeOutsideDhaka: Number(p.deliveryChargeOutsideDhaka),
    // CORRECTIONS Products §2 — the product's packing materials.
    components: p.components.map((c) => ({
      componentId: c.componentId,
      name: c.component.name,
      sku: c.component.sku,
      unit: c.component.unit,
      qty: c.qty,
      stockQty: c.component.stockQty,
    })),
    ...(showCosts
      ? {
          avgCost: Number(p.avgCost),
          // avg cost + packing materials — what P&L actually pays per unit.
          effectiveCost: safeNumber(() => productEffectiveCost(catalog, p.id)),
        }
      : {}),
  };
}

function safeNumber(fn: () => number): number | null {
  try {
    return fn();
  } catch (e) {
    if (e instanceof BomError) return null;
    throw e;
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof BomError) return fallback;
    throw e;
  }
}

// Package cost/weight/availability all run off the recursive explosion
// (CORRECTIONS Products §4/§5) with default choice selections. A structurally
// broken BOM (cycle introduced by hand in the DB) degrades to nulls instead of
// crashing list pages — the package edit dialog is where it gets fixed.
export function serializePackage(
  pkg: PackageWithItems,
  catalog: BomCatalog,
  showCosts: boolean
) {
  const cost = safeNumber(() => packageCost(catalog, pkg.id));
  const autoWeight = safeNumber(() => packageWeightKg(catalog, pkg.id));
  const availability = safe<number | null>(
    () => packageAvailability(catalog, pkg.id),
    null
  );

  // Choice groups across the whole nested tree, each option annotated with the
  // availability the package would have if that variant were picked (§5).
  const choiceGroups = safe(
    () =>
      collectChoiceGroups(catalog, pkg.id).map((g) => ({
        groupId: g.groupId,
        label: g.label,
        qty: g.qty,
        path: g.path,
        options: g.options.map((o) => {
          const product = catalog.products.get(o.productId);
          return {
            productId: o.productId,
            name: product?.name ?? `#${o.productId}`,
            isDefault: o.isDefault,
            stockQty: product?.stockQty ?? 0,
            availability: safe<number | null>(
              () =>
                packageAvailability(
                  catalog,
                  pkg.id,
                  new Map([[g.groupId, o.productId]])
                ),
              null
            ),
          };
        }),
      })),
    [] as {
      groupId: number;
      label: string;
      qty: number;
      path: string[];
      options: {
        productId: number;
        name: string;
        isDefault: boolean;
        stockQty: number;
        availability: number | null;
      }[];
    }[]
  );

  // Read-only full explosion (default picks) — lets the team see the
  // auto-included product components without re-listing them in the BOM (§2).
  const explosion = safe(
    () => {
      // Leaves that arrive WITHOUT product components, to tell direct BOM
      // content apart from auto-included packing materials.
      const stripped: BomCatalog = {
        products: new Map(
          [...catalog.products].map(([id, p]) => [id, { ...p, components: [] }])
        ),
        packages: catalog.packages,
      };
      const direct = explodePackage(stripped, pkg.id, 1);
      return [...explodePackage(catalog, pkg.id, 1)].map(([productId, qty]) => {
        const product = catalog.products.get(productId);
        return {
          productId,
          name: product?.name ?? `#${productId}`,
          qty,
          isComponentType: product?.productType === "COMPONENT",
          autoIncludedQty: qty - (direct.get(productId) ?? 0),
        };
      });
    },
    [] as {
      productId: number;
      name: string;
      qty: number;
      isComponentType: boolean;
      autoIncludedQty: number;
    }[]
  );

  return {
    id: pkg.id,
    code: pkg.code,
    name: pkg.name,
    photoUrl: pkg.photoUrl,
    sellingPrice: Number(pkg.sellingPrice),
    priceFloor: Number(pkg.priceFloor),
    isActive: pkg.isActive,
    availableToSell: availability,
    weightKg: pkg.weightKg == null ? null : Number(pkg.weightKg), // manual override
    autoWeightKg: autoWeight, // BOM-summed
    deliveryChargeInsideDhaka: Number(pkg.deliveryChargeInsideDhaka),
    deliveryChargeSubDhaka: Number(pkg.deliveryChargeSubDhaka),
    deliveryChargeOutsideDhaka: Number(pkg.deliveryChargeOutsideDhaka),
    items: pkg.items.map((it) => ({
      id: it.id,
      kind: it.kind,
      productId: it.productId,
      childPackageId: it.childPackageId,
      choiceLabel: it.choiceLabel,
      name:
        it.kind === "PRODUCT"
          ? it.product?.name ?? "(missing product)"
          : it.kind === "PACKAGE"
            ? it.childPackage?.name ?? "(missing package)"
            : it.choiceLabel ?? "Choice",
      code:
        it.kind === "PRODUCT"
          ? it.product?.sku ?? null
          : it.kind === "PACKAGE"
            ? it.childPackage?.code ?? null
            : null,
      unit: it.product?.unit ?? null,
      qty: it.qty,
      isStockTracked: it.product?.isStockTracked ?? true,
      stockQty: it.product?.stockQty ?? null,
      options: it.options.map((o) => ({
        productId: o.productId,
        name: o.product.name,
        isDefault: o.isDefault,
      })),
      ...(showCosts && it.kind === "PRODUCT" && it.product
        ? { unitCost: Number(it.product.avgCost) }
        : {}),
    })),
    choiceGroups,
    explosion,
    ...(showCosts && cost != null
      ? { cost, margin: Number(pkg.sellingPrice) - cost }
      : {}),
  };
}

// Convenience wrappers kept for pages that only need one number.
export { productAvailability, packageAvailability, productWeightKg };
