import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermissionCtx, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import {
  orderCoreSchema,
  orderScopeWhere,
  resolveItemsAndTotals,
} from "@/lib/orders";
import { EDITABLE_STATUSES } from "@/lib/order-constants";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  changes: orderCoreSchema,
  reason: z.string().trim().min(3, "Explain why the edit is needed"),
});

// SPEC §4.2 edit-request flow: after the edit window the SE submits proposed
// changes; a TL/Manager with orders.approve_edit reviews and applies them.
export async function POST(req: Request, { params }: Params) {
  try {
    const { session, permissions } = await requirePermissionCtx("orders.view_own");
    const id = Number((await params).id);
    const scope = await orderScopeWhere(session, permissions);
    const order = await prisma.order.findFirst({
      where: { AND: [{ id }, scope] },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (!EDITABLE_STATUSES.includes(order.status)) {
      throw new AuthzError(
        400,
        `Orders in status ${order.status} can no longer be edited`
      );
    }
    const pending = await prisma.orderEditRequest.findFirst({
      where: { orderId: id, status: "PENDING" },
    });
    if (pending) {
      throw new AuthzError(
        400,
        "An edit request is already pending for this order"
      );
    }

    const { changes, reason } = bodySchema.parse(await req.json());
    // Validate now so approvers never review a payload that can't apply.
    await resolveItemsAndTotals(prisma, changes);

    const request = await prisma.orderEditRequest.create({
      data: {
        orderId: id,
        requestedBy: session.user.id,
        changesJson: changes,
        reason,
      },
    });
    await logAudit({
      userId: session.user.id,
      action: "order.edit_request",
      entity: "order_edit_requests",
      entityId: request.id,
      after: { orderNo: order.orderNo, reason, changes },
    });
    return NextResponse.json({ id: request.id }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
