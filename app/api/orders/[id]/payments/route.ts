import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermissionCtx, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { mfsTxnRequired, orderScopeWhere, orderViewScope, recomputeDue } from "@/lib/orders";
import { PAYMENT_METHODS, PAYMENT_TYPES } from "@/lib/order-constants";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  type: z.enum(PAYMENT_TYPES),
  method: z.enum(PAYMENT_METHODS),
  amount: z.number().positive("Amount must be greater than 0"),
  // SPEC §8 — every payment records the wallet/account that received it.
  walletId: z.number().int().positive("Select the receiving wallet"),
  transactionId: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
  senderNumber: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
  screenshotUrl: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
  paymentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

// SPEC §8 — multiple payments per order; txn-ID unique check; due recomputed
// on every payment write in the same transaction (integrity rules 1 & 3).
// REFUND is stored positive and adds back to due.
export async function POST(req: Request, { params }: Params) {
  try {
    const { session, permissions } = await requirePermissionCtx("payments.create");
    const id = Number((await params).id);
    const data = bodySchema.parse(await req.json());

    // Scope: SE/TL restricted to their own/team orders; Accounts (payments.verify)
    // may record payments against any order even without an orders view permission.
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (!permissions.includes("payments.verify")) {
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

    if (
      data.type !== "REFUND" &&
      ["CANCELLED", "RETURNED", "REFUNDED"].includes(order.status)
    ) {
      throw new AuthzError(
        400,
        `Only refunds can be recorded on a ${order.status} order`
      );
    }
    if (mfsTxnRequired(data.method) && !data.transactionId) {
      throw new AuthzError(400, `Transaction ID is required for ${data.method}`);
    }
    const wallet = await prisma.wallet.findUnique({
      where: { id: data.walletId },
      select: { id: true, isActive: true },
    });
    if (!wallet) throw new AuthzError(400, "Receiving wallet not found");
    if (!wallet.isActive) throw new AuthzError(400, "Receiving wallet is inactive");
    if (data.transactionId) {
      const dup = await prisma.payment.findUnique({
        where: { transactionId: data.transactionId },
        select: { order: { select: { orderNo: true } } },
      });
      if (dup) {
        throw new AuthzError(
          400,
          `Transaction ID already recorded on order ${dup.order.orderNo}`
        );
      }
    }

    const { payment, due } = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          orderId: id,
          type: data.type,
          method: data.method,
          amount: data.amount,
          walletId: data.walletId,
          transactionId: data.transactionId,
          senderNumber: data.senderNumber,
          screenshotUrl: data.screenshotUrl,
          paymentDate: data.paymentDate
            ? new Date(`${data.paymentDate}T12:00:00+06:00`)
            : new Date(),
          createdBy: session.user.id,
          updatedBy: session.user.id,
        },
      });
      const due = await recomputeDue(tx, id);
      return { payment, due };
    });

    await logAudit({
      userId: session.user.id,
      action: "payment.create",
      entity: "payments",
      entityId: payment.id,
      after: {
        orderNo: order.orderNo,
        type: data.type,
        method: data.method,
        amount: data.amount,
        walletId: data.walletId,
        transactionId: data.transactionId,
        newDue: due,
      },
    });
    return NextResponse.json({ id: payment.id, due }, { status: 201 });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002" &&
      (e.meta?.target as string[] | undefined)?.includes("transaction_id")
    ) {
      return NextResponse.json(
        { error: "This transaction ID is already recorded on another payment" },
        { status: 400 }
      );
    }
    return apiError(e);
  }
}
