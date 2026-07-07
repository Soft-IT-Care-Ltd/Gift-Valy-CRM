import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermissionCtx, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { generateInvoiceSafe } from "@/lib/invoice";
import {
  applyOrderEdit,
  orderCoreSchema,
  orderScopeWhere,
  resolveItemsAndTotals,
} from "@/lib/orders";
import { EDITABLE_STATUSES } from "@/lib/order-constants";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  note: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
});

// TL/Manager review (§4.2). Approval re-validates against the live catalog and
// applies the stored payload atomically; the approver's permission covers any
// below-floor prices in the request.
export async function POST(req: Request, { params }: Params) {
  try {
    const { session, permissions } = await requirePermissionCtx(
      "orders.approve_edit"
    );
    const id = Number((await params).id);
    const { action, note } = bodySchema.parse(await req.json());

    const scope = await orderScopeWhere(session, permissions);
    const request = await prisma.orderEditRequest.findFirst({
      where: { AND: [{ id }, { order: scope }] },
      include: { order: true },
    });
    if (!request) {
      return NextResponse.json({ error: "Edit request not found" }, { status: 404 });
    }
    if (request.status !== "PENDING") {
      throw new AuthzError(400, `Request already ${request.status}`);
    }

    if (action === "REJECT") {
      await prisma.orderEditRequest.update({
        where: { id },
        data: {
          status: "REJECTED",
          reviewedBy: session.user.id,
          reviewedAt: new Date(),
          reviewNote: note,
        },
      });
      await logAudit({
        userId: session.user.id,
        action: "order.edit_request.reject",
        entity: "order_edit_requests",
        entityId: id,
        after: { orderNo: request.order.orderNo, note },
      });
      return NextResponse.json({ ok: true });
    }

    if (!EDITABLE_STATUSES.includes(request.order.status)) {
      throw new AuthzError(
        400,
        `Order moved to ${request.order.status} — reject this request instead`
      );
    }
    const payload = orderCoreSchema.parse(request.changesJson);
    const totals = await resolveItemsAndTotals(prisma, payload);

    await prisma.$transaction(async (tx) => {
      await applyOrderEdit(tx, request.orderId, payload, totals, session.user.id);
      await tx.orderEditRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          reviewedBy: session.user.id,
          reviewedAt: new Date(),
          reviewNote: note,
        },
      });
    });
    const after = await prisma.order.findUnique({
      where: { id: request.orderId },
    });
    await logAudit({
      userId: session.user.id,
      action: "order.edit_request.approve",
      entity: "orders",
      entityId: request.orderId,
      before: request.order,
      after,
    });
    // SPEC §5: approved edit changed the order → regenerate the invoice as
    // version N+1, keeping old versions.
    const hasInvoice = await prisma.invoice.findFirst({
      where: { orderId: request.orderId },
      select: { id: true },
    });
    if (hasInvoice) await generateInvoiceSafe(request.orderId, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
