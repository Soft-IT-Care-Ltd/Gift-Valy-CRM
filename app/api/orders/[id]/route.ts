import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermissionCtx, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { generateInvoiceSafe } from "@/lib/invoice";
import { canSeeCosts } from "@/lib/catalog";
import { getOrderEditWindowMinutes } from "@/lib/settings";
import {
  applyOrderEdit,
  orderCoreSchema,
  orderDetailInclude,
  orderScopeWhere,
  resolveItemsAndTotals,
  serializeOrderDetail,
  withinEditWindow,
} from "@/lib/orders";
import { EDITABLE_STATUSES } from "@/lib/order-constants";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { session, permissions } = await requirePermissionCtx("orders.view_own");
    const id = Number((await params).id);
    const scope = await orderScopeWhere(session, permissions);
    const order = await prisma.order.findFirst({
      where: { AND: [{ id }, scope] },
      include: orderDetailInclude,
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    return NextResponse.json(
      serializeOrderDetail(order, canSeeCosts(permissions))
    );
  } catch (e) {
    return apiError(e);
  }
}

// Direct edit — SPEC §4.2: the creator may edit within the window (default
// 30 min); after that only TL/Manager/Admin (orders.edit / approve_edit) may
// edit directly, and the SE must go through the edit-request flow.
export async function PATCH(req: Request, { params }: Params) {
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

    const isPrivileged =
      permissions.includes("orders.edit") ||
      permissions.includes("orders.approve_edit");
    const isCreatorInWindow =
      order.salesExecutiveId === session.user.id &&
      withinEditWindow(order.createdAt, await getOrderEditWindowMinutes());
    if (!isPrivileged && !isCreatorInWindow) {
      throw new AuthzError(
        403,
        "Edit window has expired — submit an edit request for TL/Manager approval"
      );
    }

    const payload = orderCoreSchema.parse(await req.json());
    const totals = await resolveItemsAndTotals(prisma, payload);
    if (
      totals.floorBreaches.length > 0 &&
      !permissions.includes("orders.approve_edit")
    ) {
      throw new AuthzError(
        400,
        `Below price floor — needs TL/Admin approval: ${totals.floorBreaches.join("; ")}`
      );
    }

    await prisma.$transaction(async (tx) => {
      await applyOrderEdit(tx, id, payload, totals, session.user.id);
    });
    const after = await prisma.order.findUnique({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: "order.edit",
      entity: "orders",
      entityId: id,
      before: order,
      after,
    });
    // SPEC §5: an applied edit changes invoice-visible data → regenerate as
    // version N+1 (old versions kept). ON_HOLD orders without an invoice get
    // v1 at confirmation instead.
    const hasInvoice = await prisma.invoice.findFirst({
      where: { orderId: id },
      select: { id: true },
    });
    if (hasInvoice) await generateInvoiceSafe(id, session.user.id, "AUTO_EDIT");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
