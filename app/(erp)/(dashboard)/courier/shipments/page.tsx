import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getSteadfastIntegration } from "@/lib/steadfast-integration";
import {
  ShipmentsBoardClient,
  type CourierOptionRow,
  type PendingHandoverOrder,
  type ActiveShipmentRow,
} from "@/components/courier/shipments-board-client";

export const dynamic = "force-dynamic";

// Today in Asia/Dhaka (office time) — default handover date.
function dhakaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
}

// SPEC §7 — courier operations board: hand PACKED orders to a courier, then
// advance shipment status (in transit → delivered / returned).
export default async function ShipmentsPage() {
  await requirePagePermission("courier.manage");

  const [pending, active, recent, couriers, integration] = await Promise.all([
    prisma.order.findMany({
      where: { status: "PACKED", shipment: { is: null } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        orderNo: true,
        recipientName: true,
        recipientPhoneBd: true,
        district: true,
        thana: true,
        codAmount: true,
        dueAmount: true,
        salesExecutive: { select: { name: true } },
      },
    }),
    prisma.shipment.findMany({
      where: { status: { in: ["HANDED_TO_COURIER", "IN_TRANSIT"] } },
      orderBy: { handoverDate: "asc" },
      include: {
        courier: { select: { name: true } },
        order: {
          select: { id: true, orderNo: true, recipientName: true, district: true, dueAmount: true },
        },
      },
    }),
    prisma.shipment.findMany({
      where: { status: { in: ["DELIVERED", "RETURNED"] } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        courier: { select: { name: true } },
        order: { select: { id: true, orderNo: true, recipientName: true, district: true } },
      },
    }),
    prisma.courier.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, codFeePercent: true },
    }),
    getSteadfastIntegration(),
  ]);

  const pendingRows: PendingHandoverOrder[] = pending.map((o) => ({
    id: o.id,
    orderNo: o.orderNo,
    recipientName: o.recipientName,
    recipientPhoneBd: o.recipientPhoneBd,
    district: o.district,
    thana: o.thana,
    codAmount: Number(o.codAmount),
    dueAmount: Number(o.dueAmount),
    salesExecutive: o.salesExecutive.name,
  }));

  const toActiveRow = (s: (typeof active)[number] | (typeof recent)[number]): ActiveShipmentRow => ({
    id: s.id,
    orderId: s.order.id,
    orderNo: s.order.orderNo,
    recipientName: s.order.recipientName,
    district: s.order.district,
    courier: s.courier.name,
    trackingNo: s.trackingNo,
    handoverDate: s.handoverDate.toISOString().slice(0, 10),
    expectedDelivery: s.expectedDelivery ? s.expectedDelivery.toISOString().slice(0, 10) : null,
    codAmount: Number(s.codAmount),
    status: s.status,
    codReceived: s.codReceived,
    // Steadfast integration flags (STEADFAST_INTEGRATION.md §3B): a live
    // consignment can be polled/synced, and hold/unknown raise operator flags.
    isSteadfast: s.consignmentId !== null,
    steadfastStatus: s.steadfastStatus,
    onHold: s.onHold,
    needsAttention: s.needsAttention,
  });

  const courierOptions: CourierOptionRow[] = couriers.map((c) => ({
    id: c.id,
    name: c.name,
    codFeePercent: Number(c.codFeePercent),
  }));

  return (
    <ShipmentsBoardClient
      pending={pendingRows}
      active={active.map(toActiveRow)}
      recent={recent.map(toActiveRow)}
      couriers={courierOptions}
      today={dhakaToday()}
      steadfastEnabled={integration?.isEnabled ?? false}
    />
  );
}
