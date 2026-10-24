import { Prisma } from "@prisma/client";
import {
  packagePrintKitNeeds,
  productPrintKitNeeds,
  selectionsFromJson,
  type BomCatalog,
} from "./bom";
import { loadBomCatalog } from "./bom-db";
import { normalizePrintKit, type PrintKitSpec } from "./print-kit";

// ============ PHOTO_PRINT.md PP-2 — print kits on an order ============
//
// One order_print_kits row per unit of a kit-carrying product on the order:
// a package line of qty 2 holding one Customize Chocolate Box = 2 kits.
//
// Kits hang off the ORDER, not order_items: every order edit deletes and
// recreates all items (applyOrderEdit), so a kit is matched back by its
// source_key — the line's item (+ which occurrence of it, for the rare order
// that lists the same item twice), the product's path inside the BOM, and the
// unit number:  "K12.1/K7/P5#2"  =  package 12, first such line, sub-package
// 7, product 5, second unit. Matching kits keep their row (and, from PP-4,
// their photos and cards); the kit spec is frozen when the kit is created, so
// a later change to the product never changes an existing order.

/** products.print_kit write value: a valid kit, or SQL NULL for none (an
 *  empty kit — no photos, no cards — is "none"). */
export function printKitColumn(
  input: unknown
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const kit = normalizePrintKit(input);
  return kit ? (kit as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
}

export interface OrderLineForKits {
  itemType: "PRODUCT" | "PACKAGE";
  productId: number | null;
  packageId: number | null;
  qty: number;
  choiceSelections: unknown;
}

export interface DesiredPrintKit {
  sourceKey: string;
  productId: number;
  spec: PrintKitSpec;
}

/** Every kit the order's lines need, in line order. Pure — lines must be in
 *  their saved order (order_items by id) so occurrence numbers stay stable. */
export function desiredPrintKits(
  catalog: BomCatalog,
  lines: OrderLineForKits[]
): DesiredPrintKit[] {
  const seen = new Map<string, number>();
  const kits: DesiredPrintKit[] = [];
  for (const line of lines) {
    // Ad-hoc custom lines carry neither id — nothing to inherit.
    const root =
      line.itemType === "PACKAGE" && line.packageId
        ? `K${line.packageId}`
        : line.itemType === "PRODUCT" && line.productId
          ? `P${line.productId}`
          : null;
    if (!root) continue;
    const occurrence = (seen.get(root) ?? 0) + 1;
    seen.set(root, occurrence);
    const needs =
      line.itemType === "PACKAGE"
        ? packagePrintKitNeeds(catalog, line.packageId!, selectionsFromJson(line.choiceSelections))
        : productPrintKitNeeds(catalog, line.productId!);
    for (const need of needs) {
      const units = need.units * line.qty;
      for (let u = 1; u <= units; u++) {
        kits.push({
          sourceKey: `${root}.${occurrence}/${need.path}#${u}`,
          productId: need.productId,
          spec: need.kit,
        });
      }
    }
  }
  return kits;
}

/**
 * Brings the order's kits in line with its current items — call inside the
 * same transaction that wrote the items (order create, every edit path).
 * New kits are created; kits whose line is gone are deleted. (PP-4 turns the
 * delete into "orphaned" for a kit that already holds photos or cards.)
 */
export async function syncPrintKits(
  tx: Prisma.TransactionClient,
  orderId: number,
  catalog?: BomCatalog
): Promise<{ created: number; removed: number }> {
  const [items, existing] = await Promise.all([
    tx.orderItem.findMany({
      where: { orderId },
      orderBy: { id: "asc" },
      select: {
        itemType: true,
        productId: true,
        packageId: true,
        qty: true,
        choiceSelections: true,
      },
    }),
    tx.orderPrintKit.findMany({
      where: { orderId },
      select: { id: true, sourceKey: true },
    }),
  ]);
  const desired = desiredPrintKits(catalog ?? (await loadBomCatalog(tx)), items);
  const want = new Set(desired.map((k) => k.sourceKey));
  const have = new Set(existing.map((k) => k.sourceKey));

  const toCreate = desired.filter((k) => !have.has(k.sourceKey));
  const toRemove = existing.filter((k) => !want.has(k.sourceKey)).map((k) => k.id);
  if (toCreate.length) {
    await tx.orderPrintKit.createMany({
      data: toCreate.map((k) => ({
        orderId,
        sourceKey: k.sourceKey,
        productId: k.productId,
        spec: k.spec as unknown as Prisma.InputJsonValue,
      })),
    });
  }
  if (toRemove.length) {
    await tx.orderPrintKit.deleteMany({ where: { id: { in: toRemove } } });
  }
  return { created: toCreate.length, removed: toRemove.length };
}
