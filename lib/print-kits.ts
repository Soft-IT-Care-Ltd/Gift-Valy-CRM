import { Prisma } from "@prisma/client";
import {
  packagePrintKitNeeds,
  productPrintKitNeeds,
  selectionsFromJson,
  type BomCatalog,
} from "./bom";
import { loadBomCatalog } from "./bom-db";
import { kitProgress, normalizePrintKit, type PrintKitSpec } from "./print-kit";

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
 *  - new kits are created (spec frozen from the product's current kit);
 *  - a kit whose line is gone is deleted when empty; when it already holds
 *    photos or cards, its content MOVES to a newly created kit of the same
 *    product (the SE swapped one package for another), else the kit is kept
 *    and marked orphaned ("Line removed") for Admin/Manager to clear;
 *  - an orphaned kit whose line comes back is un-orphaned.
 */
export async function syncPrintKits(
  tx: Prisma.TransactionClient,
  orderId: number,
  catalog?: BomCatalog
): Promise<{ created: number; removed: number; moved: number; orphaned: number }> {
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
      orderBy: { id: "asc" },
      select: { id: true, sourceKey: true, productId: true, status: true, photoCount: true, cardCount: true, orphanedAt: true },
    }),
  ]);
  const desired = desiredPrintKits(catalog ?? (await loadBomCatalog(tx)), items);
  const want = new Set(desired.map((k) => k.sourceKey));
  const have = new Set(existing.map((k) => k.sourceKey));

  const created: { id: number; productId: number }[] = [];
  for (const k of desired.filter((d) => !have.has(d.sourceKey))) {
    created.push(
      await tx.orderPrintKit.create({
        data: {
          orderId,
          sourceKey: k.sourceKey,
          productId: k.productId,
          spec: k.spec as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, productId: true },
      })
    );
  }

  let removed = 0;
  let moved = 0;
  let orphaned = 0;
  const claimed = new Set<number>();
  for (const kit of existing) {
    if (want.has(kit.sourceKey)) {
      if (kit.orphanedAt) {
        await tx.orderPrintKit.update({ where: { id: kit.id }, data: { orphanedAt: null } });
      }
      continue;
    }
    if (kit.photoCount + kit.cardCount === 0) {
      await tx.orderPrintKit.delete({ where: { id: kit.id } });
      removed++;
      continue;
    }
    const target = created.find((c) => c.productId === kit.productId && !claimed.has(c.id));
    if (target) {
      claimed.add(target.id);
      await tx.orderPrintPhoto.updateMany({ where: { kitId: kit.id }, data: { kitId: target.id } });
      await tx.orderPrintCard.updateMany({ where: { kitId: kit.id }, data: { kitId: target.id } });
      await tx.orderPrintKit.delete({ where: { id: kit.id } });
      await refreshKit(tx, target.id);
      // Moved after it was printed: Packing must reprint (PP-7).
      if (kit.status === "PRINTED" || kit.status === "CHANGED_AFTER_PRINT") {
        await tx.orderPrintKit.update({ where: { id: target.id }, data: { status: "CHANGED_AFTER_PRINT" } });
      }
      moved++;
    } else if (!kit.orphanedAt) {
      await tx.orderPrintKit.update({ where: { id: kit.id }, data: { orphanedAt: new Date() } });
      orphaned++;
    }
  }
  return { created: created.length, removed, moved, orphaned };
}

/**
 * Recounts a kit's photos and cards and sets its status: PENDING until every
 * photo and card is in, then READY. Once printed, any change (`changed`)
 * makes it CHANGED_AFTER_PRINT — Packing must reprint (PP-7).
 */
export async function refreshKit(
  tx: Prisma.TransactionClient,
  kitId: number,
  opts: { changed?: boolean } = {}
) {
  const kit = await tx.orderPrintKit.findUniqueOrThrow({
    where: { id: kitId },
    select: { spec: true, status: true, _count: { select: { photos: true, cards: true } } },
  });
  const spec = normalizePrintKit(kit.spec);
  const photos = kit._count.photos;
  const cards = kit._count.cards;
  const complete = spec ? kitProgress(spec, photos, cards).state === "READY" : true;
  const printed = kit.status === "PRINTED" || kit.status === "CHANGED_AFTER_PRINT";
  const status = printed
    ? opts.changed
      ? "CHANGED_AFTER_PRINT"
      : kit.status
    : complete
      ? "READY"
      : "PENDING";
  return tx.orderPrintKit.update({
    where: { id: kitId },
    data: { photoCount: photos, cardCount: cards, status },
    select: { id: true, status: true, photoCount: true, cardCount: true },
  });
}
