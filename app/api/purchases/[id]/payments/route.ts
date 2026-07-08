import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { recordPurchasePayment } from "@/lib/purchases";

type Params = { params: Promise<{ id: string }> };

// SPEC §6.3 — pay down a supplier bill from the purchase due list. Records a
// "Product Purchase" expense on the pay date from the chosen wallet (so the
// wallet balance drops and the cost shows in the R8 report on that day), then
// refreshes the purchase's cached payment status. Full or partial; over-payment
// is rejected in recordPurchasePayment.
const bodySchema = z.object({
  amount: z.number().positive("Amount must be greater than 0"),
  walletId: z.number().int().positive("Select the wallet the payment came from"),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
});

export async function POST(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("purchases.create");
    const id = Number((await params).id);
    const data = bodySchema.parse(await req.json());

    const wallet = await prisma.wallet.findUnique({
      where: { id: data.walletId },
      select: { isActive: true },
    });
    if (!wallet) throw new AuthzError(400, "Paying wallet not found");
    if (!wallet.isActive) throw new AuthzError(400, "Paying wallet is inactive");

    const result = await prisma.$transaction((tx) =>
      recordPurchasePayment(
        tx,
        {
          purchaseId: id,
          amount: data.amount,
          walletId: data.walletId,
          paymentDate: new Date(`${data.paymentDate}T00:00:00+06:00`),
          notes: data.notes,
        },
        session.user.id
      )
    );

    await logAudit({
      userId: session.user.id,
      action: "purchase.payment",
      entity: "purchases",
      entityId: id,
      after: {
        amount: data.amount,
        walletId: data.walletId,
        date: data.paymentDate,
        due: result.due,
        paymentStatus: result.status,
      },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
