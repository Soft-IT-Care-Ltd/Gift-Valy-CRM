import { prisma } from "./db";
import { dbDate } from "./order-constants";
import {
  explodePackage,
  explodeProduct,
  selectionsFromJson,
  BomError,
  type Explosion,
} from "./bom";
import { loadBomCatalog } from "./bom-db";

// ============ CORRECTIONS Stock/Purchase §1 — Delivery Requirement Planner ============
//
// "To deliver everything due in this period, what stock do I need — and how much
// must I buy?" For the orders whose requested delivery falls in the window
// (CONFIRMED + PACKED, optionally DRAFT), explode every package into its leaf
// stock-tracked products via the BOM engine and compare the total against stock.
//
// No double-counting (the spec's key caveat):
//   • CONFIRMED orders have RESERVED their stock, but the reserved units are
//     still physically on the shelf (products.stock_qty is untouched by a
//     reservation). So required includes them AND stock_qty already holds them —
//     consistent, nothing to adjust ("reserved counts as available for them").
//   • PACKED orders have DEDUCTED their stock (stock_qty already dropped). Those
//     units left the shelf but are earmarked for this same period, so we add them
//     back as available (the `packed` column) — required += X, available += X,
//     net-zero shortage. Since packing deducts exactly the BOM requirement, the
//     add-back is simply the BOM demand of the PACKED orders.
//   • DRAFT orders reserve/deduct nothing → pure additional demand vs stock_qty.

// Orders "whose requested delivery falls in the period": FIXED dates inside the
// window, plus every ASAP order (deliver-now, so it always belongs to the
// immediate demand). ANY_DAY orders are flexible — not tied to a period — and are
// intentionally excluded from the period's committed requirement.

export interface RequirementRow {
  productId: number;
  name: string;
  sku: string;
  unit: string;
  isComponent: boolean; // packaging material (component-only product)
  required: number; // Σ BOM demand across the period's orders
  packed: number; // already deducted by PACKED orders (add-back)
  inStock: number; // physical shelf (products.stock_qty)
  shortage: number; // max(required − inStock − packed, 0)
  unitCost: number; // current avg cost — the editable purchase estimate
  purchaseAmount: number; // shortage × unitCost
  enough: boolean; // shortage === 0
}

export interface RequirementPlan {
  rows: RequirementRow[];
  grandTotal: number; // Σ purchaseAmount over short rows
  orderCount: number; // orders feeding the demand
  shortageCount: number; // products short
  includeDrafts: boolean;
}

export async function buildRequirementPlan(args: {
  from: string;
  to: string;
  includeDrafts: boolean;
}): Promise<RequirementPlan> {
  const { from, to, includeDrafts } = args;
  const statuses: ("CONFIRMED" | "PACKED" | "DRAFT")[] = includeDrafts
    ? ["CONFIRMED", "PACKED", "DRAFT"]
    : ["CONFIRMED", "PACKED"];

  const [orders, catalog, meta] = await Promise.all([
    prisma.order.findMany({
      where: {
        status: { in: statuses },
        OR: [
          {
            deliveryDateMode: "FIXED",
            requestedDeliveryDate: { gte: dbDate(from), lte: dbDate(to) },
          },
          { deliveryDateMode: "ASAP" },
        ],
      },
      select: {
        status: true,
        items: {
          select: {
            itemType: true,
            productId: true,
            packageId: true,
            qty: true,
            choiceSelections: true,
          },
        },
      },
    }),
    loadBomCatalog(prisma),
    prisma.product
      .findMany({ select: { id: true, sku: true, unit: true } })
      .then((rows) => new Map(rows.map((r) => [r.id, r]))),
  ]);

  const required = new Map<number, number>();
  const packed = new Map<number, number>();

  const addLeaves = (leaves: Explosion, isPacked: boolean) => {
    for (const [productId, qty] of leaves) {
      const p = catalog.products.get(productId);
      if (!p || !p.isStockTracked) continue; // only stockable leaves plan-count
      required.set(productId, (required.get(productId) ?? 0) + qty);
      if (isPacked) packed.set(productId, (packed.get(productId) ?? 0) + qty);
    }
  };

  for (const o of orders) {
    const isPacked = o.status === "PACKED";
    for (const it of o.items) {
      try {
        if (it.itemType === "PRODUCT" && it.productId != null) {
          addLeaves(explodeProduct(catalog, it.productId, it.qty), isPacked);
        } else if (it.itemType === "PACKAGE" && it.packageId != null) {
          addLeaves(
            explodePackage(
              catalog,
              it.packageId,
              it.qty,
              selectionsFromJson(it.choiceSelections)
            ),
            isPacked
          );
        }
      } catch (e) {
        if (!(e instanceof BomError)) throw e; // broken BOM — skip that line
      }
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const rows: RequirementRow[] = [];
  for (const [productId, req] of required) {
    const p = catalog.products.get(productId)!;
    const m = meta.get(productId);
    const packedQty = packed.get(productId) ?? 0;
    const inStock = p.stockQty;
    const shortage = Math.max(req - inStock - packedQty, 0);
    const unitCost = p.avgCost;
    rows.push({
      productId,
      name: p.name,
      sku: m?.sku ?? "",
      unit: m?.unit ?? "pcs",
      isComponent: p.productType === "COMPONENT",
      required: req,
      packed: packedQty,
      inStock,
      shortage,
      unitCost,
      purchaseAmount: round2(shortage * unitCost),
      enough: shortage === 0,
    });
  }

  // Short products first (most urgent), largest shortfall on top, then by name.
  rows.sort(
    (a, b) =>
      Number(b.shortage > 0) - Number(a.shortage > 0) ||
      b.shortage - a.shortage ||
      a.name.localeCompare(b.name)
  );

  const grandTotal = round2(rows.reduce((s, r) => s + r.purchaseAmount, 0));
  const shortageCount = rows.filter((r) => r.shortage > 0).length;

  return {
    rows,
    grandTotal,
    orderCount: orders.length,
    shortageCount,
    includeDrafts,
  };
}
