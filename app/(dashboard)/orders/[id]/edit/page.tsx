import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { packageAvailable } from "@/lib/catalog";
import { getOrderEditWindowMinutes } from "@/lib/settings";
import { orderScopeWhere, withinEditWindow } from "@/lib/orders";
import { EDITABLE_STATUSES } from "@/lib/order-constants";
import {
  OrderForm,
  type OrderFormInitial,
} from "@/components/orders/order-form";

export const dynamic = "force-dynamic";

// Edit screen (§4.2): direct edit while privileged or inside the window;
// otherwise the same form submits an edit request for TL/Manager approval.
export default async function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePagePermission("orders.view_own");
  const permissions = await getEffectivePermissions(session.user.id);
  const id = Number((await params).id);
  if (!id) notFound();

  const scope = await orderScopeWhere(session, permissions);
  const order = await prisma.order.findFirst({
    where: { AND: [{ id }, scope] },
    include: { customer: true, items: true, salesExecutive: true, team: true },
  });
  if (!order) notFound();
  if (!EDITABLE_STATUSES.includes(order.status)) redirect(`/orders/${id}`);

  const privileged =
    permissions.includes("orders.edit") ||
    permissions.includes("orders.approve_edit");
  const isCreator = order.salesExecutiveId === session.user.id;
  const inWindow = withinEditWindow(
    order.createdAt,
    await getOrderEditWindowMinutes()
  );
  if (!privileged && !isCreator) redirect(`/orders/${id}`);
  const mode = privileged || inWindow ? "edit" : "edit-request";

  if (mode === "edit-request") {
    const pending = await prisma.orderEditRequest.findFirst({
      where: { orderId: id, status: "PENDING" },
    });
    if (pending) redirect(`/orders/${id}`);
  }

  const [products, packages] = await Promise.all([
    prisma.product.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.package.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: { items: { include: { product: true } } },
    }),
  ]);

  const initial: OrderFormInitial = {
    recipientName: order.recipientName,
    recipientPhoneBd: order.recipientPhoneBd,
    recipientRelation: order.recipientRelation,
    deliveryAddress: order.deliveryAddress,
    district: order.district,
    thana: order.thana,
    occasion: order.occasion,
    requestedDeliveryDate: order.requestedDeliveryDate
      ? order.requestedDeliveryDate.toISOString().slice(0, 10)
      : null,
    items: order.items.map((it) => ({
      itemType: it.itemType,
      productId: it.productId,
      packageId: it.packageId,
      qty: it.qty,
      unitPrice: Number(it.unitPrice),
    })),
    discount: Number(order.discount),
    courierCharge: Number(order.courierChargeCustomer),
    codAmount: Number(order.codAmount),
    notes: order.notes,
    customer: {
      name: order.customer.name,
      phoneForeign: order.customer.phoneForeign,
      country: order.customer.country,
    },
    orderNo: order.orderNo,
    status: order.status,
  };

  return (
    <OrderForm
      mode={mode}
      orderId={order.id}
      products={products.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        sellingPrice: Number(p.sellingPrice),
        priceFloor: Number(p.priceFloor),
        unit: p.unit,
      }))}
      packages={packages.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        sellingPrice: Number(p.sellingPrice),
        priceFloor: Number(p.priceFloor),
        availableToSell: packageAvailable(p),
      }))}
      canOverrideFloor={permissions.includes("orders.approve_edit")}
      seName={order.salesExecutive.name}
      teamName={order.team?.name ?? null}
      initial={initial}
    />
  );
}
