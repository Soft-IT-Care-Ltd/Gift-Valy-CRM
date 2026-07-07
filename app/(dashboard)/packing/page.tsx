import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import {
  PackingQueueClient,
  type PackingOrder,
  type PickLine,
} from "@/components/packing/packing-queue-client";

export const dynamic = "force-dynamic";

// Packing Queue (SPEC §2.1 Packing role / §6.2): CONFIRMED orders oldest-first,
// each with its BOM-expanded pick list. Marking PACKED deducts stock and
// freezes cost snapshots via the status API. No cost fields are exposed here.
export default async function PackingQueuePage() {
  await requirePagePermission("orders.pack");

  const orders = await prisma.order.findMany({
    where: { status: "CONFIRMED" },
    orderBy: { createdAt: "asc" },
    include: {
      items: {
        include: {
          product: {
            select: {
              id: true, sku: true, name: true, unit: true,
              isStockTracked: true, stockQty: true,
            },
          },
          package: {
            include: {
              items: {
                include: {
                  product: {
                    select: {
                      id: true, sku: true, name: true, unit: true,
                      isStockTracked: true, stockQty: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const queue: PackingOrder[] = orders.map((o) => {
    // Aggregate the pick list per product across all lines (BOM expanded).
    const pick = new Map<number, PickLine>();
    const perOrder: PickLine[] = []; // non-stock-tracked (cake/flowers) — procure per order
    const addPick = (
      p: { id: number; sku: string; name: string; unit: string; isStockTracked: boolean; stockQty: number },
      qty: number
    ) => {
      const bucket = p.isStockTracked ? pick.get(p.id) : perOrder.find((l) => l.sku === p.sku);
      if (bucket) {
        bucket.qty += qty;
      } else {
        const line: PickLine = {
          sku: p.sku, name: p.name, unit: p.unit, qty,
          onHand: p.isStockTracked ? p.stockQty : null,
        };
        if (p.isStockTracked) pick.set(p.id, line);
        else perOrder.push(line);
      }
    };
    for (const it of o.items) {
      if (it.itemType === "PRODUCT" && it.product) {
        addPick(it.product, it.qty);
      } else if (it.itemType === "PACKAGE" && it.package) {
        for (const bom of it.package.items) addPick(bom.product, it.qty * bom.qty);
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
      requestedDeliveryDate: o.requestedDeliveryDate
        ? o.requestedDeliveryDate.toISOString().slice(0, 10)
        : null,
      notes: o.notes,
      items: o.items.map((it) => ({
        name: it.product?.name ?? it.package?.name ?? it.customName ?? "(custom)",
        isPackage: it.itemType === "PACKAGE",
        qty: it.qty,
      })),
      pickList: [...pick.values()].sort((a, b) => a.name.localeCompare(b.name)),
      perOrderItems: perOrder,
    };
  });

  return <PackingQueueClient queue={queue} />;
}
