import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";

// Movement history for one product (SPEC §6.3 ledger) — read-only, stock.view.
// qty is signed (see lib/stock.ts); no cost data here, so Packing may read it.
export async function GET(req: Request) {
  try {
    await requirePermission("stock.view");
    const productId = Number(new URL(req.url).searchParams.get("productId"));
    if (!productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }

    const movements = await prisma.stockMovement.findMany({
      where: { productId },
      orderBy: { at: "desc" },
      take: 100,
    });

    // Resolve refs and actors for display: order numbers, purchase suppliers, user names.
    const orderIds = movements
      .filter((m) => m.refTable === "orders" && m.refId)
      .map((m) => m.refId!);
    const purchaseIds = movements
      .filter((m) => m.refTable === "purchases" && m.refId)
      .map((m) => m.refId!);
    const userIds = movements.map((m) => m.createdBy).filter((v): v is number => !!v);
    const [orders, purchases, users] = await Promise.all([
      prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, orderNo: true },
      }),
      prisma.purchase.findMany({
        where: { id: { in: purchaseIds } },
        select: { id: true, supplierName: true },
      }),
      prisma.user.findMany({
        where: { id: { in: [...new Set(userIds)] } },
        select: { id: true, name: true },
      }),
    ]);
    const orderNoById = new Map(orders.map((o) => [o.id, o.orderNo]));
    const supplierById = new Map(purchases.map((p) => [p.id, p.supplierName]));
    const userById = new Map(users.map((u) => [u.id, u.name]));

    return NextResponse.json({
      movements: movements.map((m) => ({
        id: m.id,
        type: m.type,
        qty: m.qty,
        at: m.at.toISOString(),
        reason: m.reason,
        ref:
          m.refTable === "orders" && m.refId
            ? { kind: "order", label: orderNoById.get(m.refId) ?? `#${m.refId}` }
            : m.refTable === "purchases" && m.refId
              ? {
                  kind: "purchase",
                  label: supplierById.get(m.refId) ?? `#${m.refId}`,
                }
              : null,
        byUser: m.createdBy ? (userById.get(m.createdBy) ?? null) : null,
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}
