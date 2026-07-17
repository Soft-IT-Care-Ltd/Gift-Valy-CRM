import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermissionCtx, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { orderScopeWhere } from "@/lib/orders";
import { releaseOrderStock } from "@/lib/stock";
import {
  ORDER_STATUS_LABELS,
  TRASHABLE_STATUSES,
  TRASH_RETENTION_DAYS,
} from "@/lib/order-constants";

type Params = { params: Promise<{ id: string }> };

// CORRECTIONS Orders §6f — Trash (soft delete). The order keeps its row for
// 30 days (restorable from the Trash tab), disappears from every list/report
// (lib/db.ts auto-filter), and any stock reservation it held is released in
// the same transaction. The cron purge hard-deletes it after 30 days.
export async function POST(req: Request, { params }: Params) {
  try {
    const { session, permissions } = await requirePermissionCtx("orders.trash");
    const id = Number((await params).id);

    const scope = await orderScopeWhere(session, permissions);
    // Auto-filter hides already-trashed orders → double-trash 404s cleanly.
    const order = await prisma.order.findFirst({
      where: { AND: [{ id }, scope] },
      select: { id: true, orderNo: true, status: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    // CORRECTIONS Orders §R5 — Admin can trash from ANY status with the dedicated
    // override permission (an escape hatch for Steadfast mishaps). Physically-out
    // stock is left deducted (releaseOrderStock below only releases reservations),
    // which is correct: the goods really are gone/with the courier. Everyone else
    // is still held to the normal trashable set.
    const isOverride = !TRASHABLE_STATUSES.includes(order.status);
    if (isOverride && !permissions.includes("orders.courier_override")) {
      throw new AuthzError(
        400,
        `A ${ORDER_STATUS_LABELS[order.status]} order cannot be trashed — ` +
          (order.status === "PACKED"
            ? "cancel it first so the packed stock returns to inventory"
            : order.status === "HANDED_TO_COURIER" || order.status === "IN_TRANSIT"
              ? "the parcel is with the courier; finish or return the shipment first"
              : "it is a completed sale; use the cancel/refund flows instead")
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          deletedBy: session.user.id,
          updatedBy: session.user.id,
        },
      });
      // §6f: release whatever reservation the ledger says this order holds
      // (only CONFIRMED orders hold one; everywhere else this is a no-op).
      await releaseOrderStock(tx, id, session.user.id, {
        restoreDeducted: false,
        reason: `Order ${order.orderNo} trashed`,
      });
    });
    await logAudit({
      userId: session.user.id,
      action: isOverride ? "order.trash_override" : "order.trash",
      entity: "orders",
      entityId: id,
      before: { orderNo: order.orderNo, status: order.status },
      after: {
        deletedAt: new Date().toISOString(),
        retentionDays: TRASH_RETENTION_DAYS,
        manualOverride: isOverride,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
