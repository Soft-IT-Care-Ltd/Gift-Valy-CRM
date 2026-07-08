import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import {
  VerificationQueueClient,
  type VerifyPaymentRow,
} from "@/components/money/verification-queue-client";

export const dynamic = "force-dynamic";

// Recently-verified window: keep the last 30 days visible so a mistaken sign-off
// can be flagged back. Helper keeps Date.now() out of the component render body.
function verifiedCutoff(): Date {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

// SPEC §8 — Accounts verification queue: payments awaiting sign-off against the
// wallet statement; unverified ones stay flagged. payments.verify roles.
export default async function VerificationPage() {
  await requirePagePermission("payments.verify");

  // The queue = everything not yet verified (oldest first), plus payments
  // verified in the last 30 days so a mistaken sign-off can be flagged back.
  const cutoff = verifiedCutoff();
  const payments = await prisma.payment.findMany({
    where: {
      OR: [{ isVerified: false }, { isVerified: true, updatedAt: { gte: cutoff } }],
    },
    orderBy: [{ isVerified: "asc" }, { paymentDate: "asc" }],
    include: {
      wallet: { select: { name: true } },
      order: {
        select: {
          id: true,
          orderNo: true,
          customer: { select: { name: true } },
        },
      },
    },
  });

  const rows: VerifyPaymentRow[] = payments.map((p) => ({
    id: p.id,
    paymentDate: p.paymentDate.toISOString(),
    orderId: p.order.id,
    orderNo: p.order.orderNo,
    customerName: p.order.customer.name,
    type: p.type,
    method: p.method,
    walletName: p.wallet?.name ?? null,
    amount: Number(p.amount),
    transactionId: p.transactionId,
    senderNumber: p.senderNumber,
    screenshotUrl: p.screenshotUrl,
    isVerified: p.isVerified,
  }));

  return <VerificationQueueClient rows={rows} />;
}
