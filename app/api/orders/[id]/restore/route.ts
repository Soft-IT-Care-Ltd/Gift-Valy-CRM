import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermissionCtx, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { orderScopeWhere } from "@/lib/orders";
import { syncReservations } from "@/lib/stock";

type Params = { params: Promise<{ id: string }> };

// CORRECTIONS Orders §6f — restore from Trash within the 30-day window. The
// order rejoins every list/report, and a CONFIRMED order re-reserves its stock
// (the reservation was released when it was trashed).
export async function POST(req: Request, { params }: Params) {
  try {
    const { session, permissions } = await requirePermissionCtx("orders.trash");
    const id = Number((await params).id);

    const scope = await orderScopeWhere(session, permissions);
    // Explicit deletedAt filter opts out of the lib/db.ts auto-filter — this
    // is one of the few queries that must see trashed rows.
    const order = await prisma.order.findFirst({
      where: { AND: [{ id }, { deletedAt: { not: null } }, scope] },
      select: { id: true, orderNo: true, status: true, deletedAt: true },
    });
    if (!order) {
      return NextResponse.json(
        { error: "Order not found in trash" },
        { status: 404 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: { deletedAt: null, deletedBy: null, updatedBy: session.user.id },
      });
      if (order.status === "CONFIRMED") {
        await syncReservations(tx, id, session.user.id);
      }
    });
    await logAudit({
      userId: session.user.id,
      action: "order.restore",
      entity: "orders",
      entityId: id,
      before: {
        orderNo: order.orderNo,
        status: order.status,
        deletedAt: order.deletedAt?.toISOString(),
      },
      after: { restored: true },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
