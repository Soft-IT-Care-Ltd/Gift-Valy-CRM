import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import {
  BomError,
  explodePackage,
  explodeProduct,
  selectionsFromJson,
  type Explosion,
  type StoredChoiceSelection,
} from "@/lib/bom";
import { loadBomCatalog } from "@/lib/bom-db";
import {
  PackingQueueClient,
  type PackingOrder,
  type PickLine,
} from "@/components/packing/packing-queue-client";

export const dynamic = "force-dynamic";

// Packing Queue (SPEC §2.1 Packing role / §6.2): CONFIRMED orders oldest-first,
// each with its BOM-expanded pick list — the FULL recursive explosion
// (CORRECTIONS Products §2/§5): nested sub-packages, the chosen variant of
// every choice group, and each product's own packing materials. Marking PACKED
// deducts stock and freezes cost snapshots via the status API. No cost fields
// are exposed here.
export default async function PackingQueuePage() {
  await requirePagePermission("orders.pack");

  const [orders, catalog, productMeta] = await Promise.all([
    prisma.order.findMany({
      where: { status: "CONFIRMED" },
      orderBy: { createdAt: "asc" },
      include: {
        items: {
          include: {
            product: { select: { name: true } },
            package: { select: { name: true } },
          },
        },
      },
    }),
    loadBomCatalog(prisma),
    prisma.product
      .findMany({ select: { id: true, sku: true, unit: true } })
      .then((rows) => new Map(rows.map((r) => [r.id, r]))),
  ]);

  const queue: PackingOrder[] = orders.map((o) => {
    // Aggregate the pick list per leaf product across all lines.
    const pick = new Map<number, PickLine>();
    const perOrder = new Map<number, PickLine>(); // non-stock-tracked (cake/flowers) — procure per order
    const addLeaves = (leaves: Explosion) => {
      for (const [productId, qty] of leaves) {
        const p = catalog.products.get(productId);
        if (!p) continue;
        const meta = productMeta.get(productId);
        const bucket = p.isStockTracked ? pick : perOrder;
        const line = bucket.get(productId);
        if (line) {
          line.qty += qty;
        } else {
          bucket.set(productId, {
            sku: meta?.sku ?? "",
            name: p.name,
            unit: meta?.unit ?? "pcs",
            qty,
            onHand: p.isStockTracked ? p.stockQty : null,
          });
        }
      }
    };
    for (const it of o.items) {
      try {
        if (it.itemType === "PRODUCT" && it.productId != null) {
          addLeaves(explodeProduct(catalog, it.productId, it.qty));
        } else if (it.itemType === "PACKAGE" && it.packageId != null) {
          addLeaves(
            explodePackage(
              catalog,
              it.packageId,
              it.qty,
              selectionsFromJson(it.choiceSelections)
            )
          );
        }
      } catch (e) {
        if (!(e instanceof BomError)) throw e; // broken BOM — skip its pick lines
      }
    }
    return {
      id: o.id,
      orderNo: o.orderNo,
      createdAt: o.createdAt.toISOString(),
      recipientName: o.recipientName,
      recipientPhoneBd: o.recipientPhoneBd,
      district: o.district,
      thana: o.thana,
      occasion: o.occasion,
      deliveryDateMode: o.deliveryDateMode,
      requestedDeliveryDate: o.requestedDeliveryDate
        ? o.requestedDeliveryDate.toISOString().slice(0, 10)
        : null,
      notes: o.notes,
      courierNote: o.courierNote,
      items: o.items.map((it) => {
        const picks =
          (it.choiceSelections as StoredChoiceSelection[] | null) ?? [];
        const name =
          it.product?.name ?? it.package?.name ?? it.customName ?? "(custom)";
        return {
          name:
            picks.length > 0
              ? `${name} (${picks.map((p) => p.name).join(", ")})`
              : name,
          isPackage: it.itemType === "PACKAGE",
          qty: it.qty,
        };
      }),
      pickList: [...pick.values()].sort((a, b) => a.name.localeCompare(b.name)),
      perOrderItems: [...perOrder.values()].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    };
  });

  // Pack in delivery priority (CORRECTIONS Orders §1): ASAP first, then fixed
  // dates earliest-first, then flexible any-day — oldest first within a group.
  // (The full date-grouped Delivery Schedule view arrives with C7.)
  const modeRank = { ASAP: 0, FIXED: 1, ANY_DAY: 2 } as const;
  queue.sort(
    (a, b) =>
      modeRank[a.deliveryDateMode] - modeRank[b.deliveryDateMode] ||
      (a.requestedDeliveryDate ?? "").localeCompare(
        b.requestedDeliveryDate ?? ""
      ) ||
      a.createdAt.localeCompare(b.createdAt)
  );

  return <PackingQueueClient queue={queue} />;
}
