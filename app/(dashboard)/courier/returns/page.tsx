import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import {
  ReturnsClient,
  type ReturnRow,
} from "@/components/courier/returns-client";

export const dynamic = "force-dynamic";

// SPEC §1.3 / §7 — returns awaiting Admin approval. Approving restores stock
// (IN_RETURN) and records the return courier charge as an expense.
export default async function ReturnsPage() {
  await requirePagePermission("courier.approve_return");

  const [pending, approved] = await Promise.all([
    prisma.shipment.findMany({
      where: { status: "RETURNED", returnApproved: false },
      orderBy: { returnedAt: "asc" },
      include: {
        courier: { select: { name: true } },
        order: {
          select: {
            id: true,
            orderNo: true,
            recipientName: true,
            district: true,
            totalAmount: true,
            advanceAmount: true,
            dueAmount: true,
          },
        },
      },
    }),
    prisma.shipment.findMany({
      where: { status: "RETURNED", returnApproved: true },
      orderBy: { returnApprovedAt: "desc" },
      take: 20,
      include: {
        courier: { select: { name: true } },
        order: { select: { id: true, orderNo: true, recipientName: true, district: true } },
      },
    }),
  ]);

  const toRow = (s: (typeof pending)[number]): ReturnRow => ({
    shipmentId: s.id,
    orderId: s.order.id,
    orderNo: s.order.orderNo,
    courier: s.courier.name,
    recipientName: s.order.recipientName,
    district: s.order.district,
    returnedAt: s.returnedAt ? s.returnedAt.toISOString() : null,
    totalAmount: Number(s.order.totalAmount),
    advanceAmount: Number(s.order.advanceAmount),
    dueAmount: Number(s.order.dueAmount),
    returnCharge: s.returnCharge != null ? Number(s.returnCharge) : null,
  });

  const approvedRows: ReturnRow[] = approved.map((s) => ({
    shipmentId: s.id,
    orderId: s.order.id,
    orderNo: s.order.orderNo,
    courier: s.courier.name,
    recipientName: s.order.recipientName,
    district: s.order.district,
    returnedAt: s.returnedAt ? s.returnedAt.toISOString() : null,
    totalAmount: 0,
    advanceAmount: 0,
    dueAmount: 0,
    returnCharge: s.returnCharge != null ? Number(s.returnCharge) : null,
  }));

  return <ReturnsClient pending={pending.map(toRow)} approved={approvedRows} />;
}
