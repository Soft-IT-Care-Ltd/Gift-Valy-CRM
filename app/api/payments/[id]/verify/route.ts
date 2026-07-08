import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

// SPEC §8 — Accounts verifies a payment against the wallet statement, or flags
// it back to unverified. verified_by tracks who signed off (cleared on un-verify).
const bodySchema = z.object({ isVerified: z.boolean() });

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("payments.verify");
    const id = Number((await params).id);
    const { isVerified } = bodySchema.parse(await req.json());

    const payment = await prisma.payment.findUnique({
      where: { id },
      select: {
        id: true,
        isVerified: true,
        order: { select: { orderNo: true } },
      },
    });
    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    await prisma.payment.update({
      where: { id },
      data: {
        isVerified,
        verifiedBy: isVerified ? session.user.id : null,
        updatedBy: session.user.id,
      },
    });

    await logAudit({
      userId: session.user.id,
      action: isVerified ? "payment.verify" : "payment.unverify",
      entity: "payments",
      entityId: id,
      before: { orderNo: payment.order.orderNo, isVerified: payment.isVerified },
      after: { orderNo: payment.order.orderNo, isVerified },
    });
    return NextResponse.json({ ok: true, isVerified });
  } catch (e) {
    return apiError(e);
  }
}
