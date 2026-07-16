import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, apiError, AuthzError } from "@/lib/authz";
import { getEffectivePermissions } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { generateInvoiceSafe } from "@/lib/invoice";
import {
  confirmDraftTx,
  orderScopeWhere,
  orderViewScope,
  statusChangePermitted,
} from "@/lib/orders";
import { syncStockForStatus } from "@/lib/stock";
import { ALLOWED_TRANSITIONS, ORDER_STATUSES } from "@/lib/order-constants";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  to: z.enum(ORDER_STATUSES),
  note: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
});

// Status lifecycle per SPEC §1.3, every change logged to order_status_history
// (§4.2). Stock follows the status in the same transaction (SPEC §6.3):
// RESERVE at CONFIRMED, RELEASE+OUT_SALE at PACKED (+ cost snapshot freeze),
// RELEASE on hold/cancel, IN_RETURN restore on RETURNED / post-pack cancel.
export async function POST(req: Request, { params }: Params) {
  try {
    // Base auth only — Packing has orders.pack but no view permission, so the
    // scope check below is per-case rather than requirePermission("orders.view_own").
    const session = await requireUser();
    const permissions = await getEffectivePermissions(session.user.id);
    const id = Number((await params).id);
    const { to, note } = bodySchema.parse(await req.json());

    const order = await prisma.order.findUnique({
      where: { id },
      include: { payments: { select: { type: true, amount: true, isRejected: true } } },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Scope: normal view scope, or packing staff acting on the packing queue.
    const packingMove =
      to === "PACKED" &&
      order.status === "CONFIRMED" &&
      permissions.includes("orders.pack");
    if (!packingMove) {
      if (!orderViewScope(permissions)) {
        throw new AuthzError(403, "No order view permission");
      }
      const scope = await orderScopeWhere(session, permissions);
      const inScope = await prisma.order.findFirst({
        where: { AND: [{ id }, scope] },
        select: { id: true },
      });
      if (!inScope) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }
    }

    if (!statusChangePermitted(to, permissions)) {
      throw new AuthzError(403, `Not allowed to move an order to ${to}`);
    }
    if (!ALLOWED_TRANSITIONS[order.status].includes(to)) {
      throw new AuthzError(
        400,
        `Cannot move from ${order.status} to ${to}`
      );
    }
    if (to === "CANCELLED" && !note) {
      throw new AuthzError(400, "Cancel requires a reason");
    }
    // SPEC §1.3: COMPLETED requires due_amount = 0.
    if (to === "COMPLETED" && Number(order.dueAmount) !== 0) {
      throw new AuthzError(
        400,
        `Cannot complete: due amount is ৳${Number(order.dueAmount)} (must be 0)`
      );
    }
    // SPEC §1.3: no CONFIRMED without an advance — override needs approve_edit + note.
    if (to === "CONFIRMED") {
      // Rejected payments (money never received, SPEC §8) don't count as an advance.
      const paid = order.payments.reduce(
        (s, p) =>
          p.isRejected
            ? s
            : s + (p.type === "REFUND" ? -Number(p.amount) : Number(p.amount)),
        0
      );
      if (paid <= 0) {
        if (!permissions.includes("orders.approve_edit") || !note) {
          throw new AuthzError(
            400,
            "Cannot confirm without an advance payment — TL/Admin override with a reason required"
          );
        }
      }
    }

    // DRAFT → CONFIRMED runs the full confirm-from-draft path (real GV number,
    // reserve, lead → Converted; CORRECTIONS Leads §10). Retries cover a
    // concurrent GV-number collision.
    if (order.status === "DRAFT" && to === "CONFIRMED") {
      for (let attempt = 0; ; attempt++) {
        try {
          await prisma.$transaction(async (tx) => {
            await confirmDraftTx(tx, id, session.user.id, note);
          });
          break;
        } catch (err) {
          const collision =
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002" &&
            (err.meta?.target as string[] | undefined)?.includes("order_no");
          if (!collision || attempt === 2) throw err;
        }
      }
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id },
          data: {
            status: to,
            cancelReason: to === "CANCELLED" ? note : order.cancelReason,
            updatedBy: session.user.id,
          },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId: id,
            fromStatus: order.status,
            toStatus: to,
            byUser: session.user.id,
            note,
          },
        });
        await syncStockForStatus(tx, id, to, session.user.id, note);
      });
    }
    await logAudit({
      userId: session.user.id,
      action: "order.status_change",
      entity: "orders",
      entityId: id,
      before: { status: order.status },
      after: { status: to, note },
    });
    // SPEC §5: first confirmation (e.g. ON_HOLD → CONFIRMED once the advance
    // lands) generates invoice v1 if none exists yet.
    if (to === "CONFIRMED") {
      const existing = await prisma.invoice.findFirst({
        where: { orderId: id },
        select: { id: true },
      });
      if (!existing) await generateInvoiceSafe(id, session.user.id);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
