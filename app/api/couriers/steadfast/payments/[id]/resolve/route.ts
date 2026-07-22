import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getSteadfastPayoutWalletId } from "@/lib/settings";
import { resolveSteadfastPaymentItem } from "@/lib/steadfast-payments";

type Params = { params: Promise<{ id: string }> };

// CORRECTIONS Round 2 §2.7 — resolve a payout discrepancy (Admin/Accounts:
// payments.verify). Body: { itemId, action: "ACCEPT" | "DISPUTE", note }.
// ACCEPT records THEIR figure as the COD payment (reason required) and lets
// the order auto-complete; DISPUTE marks the consignment contested — the
// payout can never finalize its charges around a disputed parcel.
export async function POST(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("payments.verify");
    const paymentId = Number((await params).id);
    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      throw new AuthzError(400, "Invalid payment id");
    }

    let body: { itemId?: unknown; action?: unknown; note?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      throw new AuthzError(400, "Invalid JSON body");
    }
    const itemId = Number(body.itemId);
    const action = String(body.action ?? "").toUpperCase();
    const note = typeof body.note === "string" ? body.note : null;
    if (!Number.isInteger(itemId) || itemId <= 0) {
      throw new AuthzError(400, "Invalid item id");
    }
    if (action !== "ACCEPT" && action !== "DISPUTE") {
      throw new AuthzError(400, "action must be ACCEPT or DISPUTE");
    }

    // The item must belong to the payment in the URL (no cross-payout writes).
    const item = await prisma.steadfastPaymentItem.findUnique({
      where: { id: itemId },
      select: { paymentId: true, reconcileStatus: true },
    });
    if (!item || item.paymentId !== paymentId) {
      throw new AuthzError(404, "Payment item not found");
    }

    const walletId = await getSteadfastPayoutWalletId();
    const outcome = await prisma.$transaction((tx) =>
      resolveSteadfastPaymentItem(tx, {
        itemId,
        action: action as "ACCEPT" | "DISPUTE",
        note,
        userId: session.user.id,
        walletId,
      })
    );

    await logAudit({
      userId: session.user.id,
      action: "steadfast.payout_discrepancy_resolve",
      entity: "steadfast_payment_items",
      entityId: itemId,
      before: { reconcileStatus: item.reconcileStatus },
      after: { ...outcome, note },
    });

    return NextResponse.json(outcome);
  } catch (e) {
    return apiError(e);
  }
}
