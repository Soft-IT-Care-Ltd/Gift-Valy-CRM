import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import {
  BomError,
  explodePackage,
  explodeProduct,
  packageContentsTree,
  productContentsTree,
  selectionsFromJson,
  type BomTreeNode,
  type Explosion,
  type StoredChoiceSelection,
} from "@/lib/bom";
import { loadBomCatalog } from "@/lib/bom-db";
import { dhakaTomorrow } from "@/lib/delivery-schedule";
import {
  PackingQueueClient,
  type BreakdownLine,
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

  // §3 — a fixed-date order due today/tomorrow, still in the packing queue
  // (CONFIRMED), is at risk of missing its promised date.
  const tomorrow = dhakaTomorrow();

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

    // §2.2 — per-item structured breakdown: the SAME walk as the pick list but
    // with nesting kept, so the packer sees what goes INSIDE each package
    // (components + qty, the chosen variant of every choice group, packing
    // materials) instead of only the aggregated leaf totals.
    const flattenTree = (
      node: BomTreeNode,
      depth: number,
      out: BreakdownLine[]
    ) => {
      for (const child of node.children) {
        const meta =
          child.productId != null ? productMeta.get(child.productId) : undefined;
        out.push({
          depth,
          kind: child.kind,
          name: child.name,
          sku: meta?.sku ?? null,
          qty: child.qty,
          unit: meta?.unit ?? "pcs",
          choiceLabel: child.choiceLabel,
        });
        flattenTree(child, depth + 1, out);
      }
    };
    const breakdownFor = (it: (typeof o.items)[number]): BreakdownLine[] => {
      const out: BreakdownLine[] = [];
      try {
        if (it.itemType === "PRODUCT" && it.productId != null) {
          flattenTree(productContentsTree(catalog, it.productId, it.qty), 0, out);
        } else if (it.itemType === "PACKAGE" && it.packageId != null) {
          flattenTree(
            packageContentsTree(
              catalog,
              it.packageId,
              it.qty,
              selectionsFromJson(it.choiceSelections)
            ),
            0,
            out
          );
        }
      } catch (e) {
        if (!(e instanceof BomError)) throw e; // broken BOM — item shows plain
        return [];
      }
      return out;
    };
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
      lateRisk:
        o.deliveryDateMode === "FIXED" &&
        o.requestedDeliveryDate != null &&
        o.requestedDeliveryDate.toISOString().slice(0, 10) <= tomorrow,
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
          breakdown: breakdownFor(it),
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
