import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermissionCtx, apiError } from "@/lib/authz";
import { orderScopeWhere } from "@/lib/orders";

// Pending edit requests visible to the approver's scope (TL = team, Admin = all).
export async function GET() {
  try {
    const { session, permissions } = await requirePermissionCtx(
      "orders.approve_edit"
    );
    const scope = await orderScopeWhere(session, permissions);
    const requests = await prisma.orderEditRequest.findMany({
      where: { status: "PENDING", order: scope },
      orderBy: { createdAt: "asc" },
      include: {
        order: { select: { id: true, orderNo: true, status: true } },
        requester: { select: { name: true } },
      },
    });
    return NextResponse.json(
      requests.map((r) => ({
        id: r.id,
        orderId: r.order.id,
        orderNo: r.order.orderNo,
        orderStatus: r.order.status,
        requestedBy: r.requester.name,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      }))
    );
  } catch (e) {
    return apiError(e);
  }
}
