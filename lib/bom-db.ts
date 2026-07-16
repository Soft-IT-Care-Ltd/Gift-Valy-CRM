import type { Prisma, PrismaClient } from "@prisma/client";
import {
  BomError,
  assertValidPackageBom,
  type BomCatalog,
  type BomLine,
  type BomLineKind,
  type BomProductType,
} from "./bom";

type Tx = Prisma.TransactionClient | PrismaClient;

// Component rules (CORRECTIONS Products §1/§2), shared by product create +
// update: COMPONENT products carry no price and no components of their own; a
// component line must reference a COMPONENT-type product. This keeps
// product-level BOMs one level deep, so they can never cycle.
export async function validateComponentRules(
  tx: Tx,
  data: {
    productType: "SELLABLE" | "COMPONENT";
    components: { componentId: number; qty: number }[];
    selfId?: number;
  }
): Promise<string | null> {
  if (data.productType === "COMPONENT") {
    if (data.components.length > 0) {
      return "A component-only product cannot have packing materials of its own";
    }
    return null;
  }
  if (data.components.length === 0) return null;
  if (data.selfId && data.components.some((c) => c.componentId === data.selfId)) {
    return "A product cannot be its own packing material";
  }
  const rows = await tx.product.findMany({
    where: { id: { in: data.components.map((c) => c.componentId) } },
    select: { id: true, name: true, productType: true },
  });
  if (rows.length !== data.components.length) {
    return "One or more packing materials do not exist";
  }
  const nonComponent = rows.find((r) => r.productType !== "COMPONENT");
  if (nonComponent) {
    return `"${nonComponent.name}" is not a component-only product — packing materials must be Component-only items`;
  }
  return null;
}

// Loads the whole catalog graph (products + components, packages + BOM lines +
// choice options) into the in-memory shape lib/bom.ts explodes over. The
// catalog is small (hundreds of rows), and loading it whole keeps every
// consumer — reserve/deduct, cost snapshots, packing queue, serializers,
// the future Requirement Planner — on one code path with no N+1 recursion.
// The wire shape of a BOM line on package create/update (CORRECTIONS Products
// §4/§5): a product, a nested sub-package, or a choice group with options.
export interface PackageItemInput {
  kind: "PRODUCT" | "PACKAGE" | "CHOICE";
  productId?: number | null;
  childPackageId?: number | null;
  choiceLabel?: string | null;
  qty: number;
  options?: { productId: number; isDefault?: boolean }[];
}

// Full structural validation of a package BOM before it is written: per-kind
// field shape, referenced rows exist, one default per choice group, and —
// via the engine — cycle prevention + the nesting cap (§5). Returns a
// human-readable error or null. `packageId` is null on create (a brand-new
// package cannot be contained by anything yet).
export async function validatePackageBomInput(
  tx: Tx,
  packageId: number | null,
  items: PackageItemInput[]
): Promise<string | null> {
  if (items.length === 0) return "A package needs at least one BOM line";

  for (const it of items) {
    if (it.kind === "PRODUCT") {
      if (!it.productId) return "A product line must pick a product";
    } else if (it.kind === "PACKAGE") {
      if (!it.childPackageId) return "A sub-package line must pick a package";
      if (packageId != null && it.childPackageId === packageId) {
        return "A package cannot contain itself";
      }
    } else {
      const options = it.options ?? [];
      if (options.length < 2) {
        return "A choice group needs at least two options";
      }
      if (!it.choiceLabel?.trim()) {
        return "A choice group needs a label (e.g. \"Teddy colour\")";
      }
      if (new Set(options.map((o) => o.productId)).size !== options.length) {
        return "A choice group lists the same product twice";
      }
      if (options.filter((o) => o.isDefault).length !== 1) {
        return "Mark exactly one default option per choice group";
      }
    }
  }

  const productLines = items.filter((i) => i.kind === "PRODUCT");
  if (
    new Set(productLines.map((i) => i.productId)).size !== productLines.length
  ) {
    return "Duplicate product in BOM — increase qty instead";
  }
  const packageLines = items.filter((i) => i.kind === "PACKAGE");
  if (
    new Set(packageLines.map((i) => i.childPackageId)).size !==
    packageLines.length
  ) {
    return "Duplicate sub-package in BOM — increase qty instead";
  }

  const productIds = [
    ...new Set([
      ...productLines.map((i) => i.productId!),
      ...items.flatMap((i) => (i.options ?? []).map((o) => o.productId)),
    ]),
  ];
  const foundProducts = await tx.product.count({
    where: { id: { in: productIds } },
  });
  if (foundProducts !== productIds.length) {
    return "One or more BOM products do not exist";
  }
  const childIds = [...new Set(packageLines.map((i) => i.childPackageId!))];
  if (childIds.length > 0) {
    const foundPackages = await tx.package.count({
      where: { id: { in: childIds } },
    });
    if (foundPackages !== childIds.length) {
      return "One or more sub-packages do not exist";
    }
  }

  // Engine-level structural check: explode the simulated BOM (cycles, depth
  // cap, missing refs) and re-walk every package that could now exceed the cap.
  const catalog = await loadBomCatalog(tx);
  const simulatedId = packageId ?? -1;
  const lines: BomLine[] = items.map((it, idx) => ({
    id: -(idx + 1), // synthetic — only choice selections key off real ids
    kind: it.kind,
    productId: it.kind === "PRODUCT" ? it.productId! : null,
    childPackageId: it.kind === "PACKAGE" ? it.childPackageId! : null,
    choiceLabel: it.choiceLabel ?? null,
    qty: it.qty,
    options: (it.options ?? []).map((o) => ({
      productId: o.productId,
      isDefault: !!o.isDefault,
    })),
  }));
  try {
    assertValidPackageBom(catalog, simulatedId, lines);
  } catch (e) {
    if (e instanceof BomError) return e.message;
    throw e;
  }
  return null;
}

// Replace a package's BOM lines (and their options) with `items`. Runs inside
// the caller's transaction, AFTER validatePackageBomInput passed.
export async function writePackageItems(
  tx: Tx,
  packageId: number,
  items: PackageItemInput[]
) {
  await tx.packageItem.deleteMany({ where: { packageId } });
  for (const it of items) {
    await tx.packageItem.create({
      data: {
        packageId,
        kind: it.kind,
        productId: it.kind === "PRODUCT" ? it.productId : null,
        childPackageId: it.kind === "PACKAGE" ? it.childPackageId : null,
        choiceLabel: it.kind === "CHOICE" ? it.choiceLabel?.trim() : null,
        qty: it.qty,
        options:
          it.kind === "CHOICE"
            ? {
                createMany: {
                  data: (it.options ?? []).map((o) => ({
                    productId: o.productId,
                    isDefault: !!o.isDefault,
                  })),
                },
              }
            : undefined,
      },
    });
  }
}

export async function loadBomCatalog(tx: Tx): Promise<BomCatalog> {
  const [products, packages] = await Promise.all([
    tx.product.findMany({
      select: {
        id: true,
        name: true,
        productType: true,
        isStockTracked: true,
        stockQty: true,
        avgCost: true,
        weightKg: true,
        components: { select: { componentId: true, qty: true } },
      },
    }),
    tx.package.findMany({
      select: {
        id: true,
        name: true,
        weightKg: true,
        items: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            kind: true,
            productId: true,
            childPackageId: true,
            choiceLabel: true,
            qty: true,
            options: {
              orderBy: { id: "asc" },
              select: { productId: true, isDefault: true },
            },
          },
        },
      },
    }),
  ]);

  return {
    products: new Map(
      products.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          productType: p.productType as BomProductType,
          isStockTracked: p.isStockTracked,
          stockQty: p.stockQty,
          avgCost: Number(p.avgCost),
          weightKg: p.weightKg == null ? null : Number(p.weightKg),
          components: p.components,
        },
      ])
    ),
    packages: new Map(
      packages.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          weightKg: p.weightKg == null ? null : Number(p.weightKg),
          items: p.items.map((it) => ({
            id: it.id,
            kind: it.kind as BomLineKind,
            productId: it.productId,
            childPackageId: it.childPackageId,
            choiceLabel: it.choiceLabel,
            qty: it.qty,
            options: it.options,
          })),
        },
      ])
    ),
  };
}
