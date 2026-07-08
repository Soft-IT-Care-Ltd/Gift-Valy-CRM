import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { recomputeDue } from "@/lib/orders";

type Params = { params: Promise<{ id: string }> };

// SPEC §8 — Accounts checks a recorded payment against the wallet statement and
// resolves it one of three ways:
//   verify → money confirmed in the wallet
//   reject → money never arrived (fake txn / wrong amount); needs a reason and
//            the payment is removed from due & collections
//   reopen → back to pending (undo a mistaken verify/reject)
// is_verified and is_rejected are mutually exclusive. Due is recomputed in the
// same transaction because rejecting/reopening changes what an order still owes.
const bodySchema = z.object({
  action: z.enum(["verify", "reject", "reopen"]),
  reason: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("payments.verify");
    const id = Number((await params).id);
    const { action, reason } = bodySchema.parse(await req.json());

    if (action === "reject" && !reason) {
      throw new AuthzError(400, "A reason is required to reject a payment");
    }

    const payment = await prisma.payment.findUnique({
      where: { id },
      select: {
        id: true,
        orderId: true,
        isVerified: true,
        isRejected: true,
        order: { select: { orderNo: true } },
      },
    });
    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    const data =
      action === "verify"
        ? {
            isVerified: true,
            verifiedBy: session.user.id,
            isRejected: false,
            rejectedBy: null,
            rejectionReason: null,
          }
        : action === "reject"
          ? {
              isRejected: true,
              rejectedBy: session.user.id,
              rejectionReason: reason,
              isVerified: false,
              verifiedBy: null,
            }
          : {
              // reopen → pending
              isVerified: false,
              verifiedBy: null,
              isRejected: false,
              rejectedBy: null,
              rejectionReason: null,
            };

    const due = await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id },
        data: { ...data, updatedBy: session.user.id },
      });
      // Rejecting excludes the amount; verifying/reopening re-includes it.
      return recomputeDue(tx, payment.orderId);
    });

    await logAudit({
      userId: session.user.id,
      action: `payment.${action}`,
      entity: "payments",
      entityId: id,
      before: {
        orderNo: payment.order.orderNo,
        isVerified: payment.isVerified,
        isRejected: payment.isRejected,
      },
      after: {
        orderNo: payment.order.orderNo,
        isVerified: data.isVerified,
        isRejected: data.isRejected,
        reason: reason ?? undefined,
        newDue: due,
      },
    });
    return NextResponse.json({ ok: true, action, due });
  } catch (e) {
    return apiError(e);
  }
}
