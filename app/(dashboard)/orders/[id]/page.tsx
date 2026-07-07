import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { canSeeCosts } from "@/lib/catalog";
import { getOrderEditWindowMinutes } from "@/lib/settings";
import {
  orderDetailInclude,
  orderScopeWhere,
  serializeOrderDetail,
  statusChangePermitted,
  withinEditWindow,
} from "@/lib/orders";
import {
  ALLOWED_TRANSITIONS,
  EDITABLE_STATUSES,
} from "@/lib/order-constants";
import { OrderDetailClient } from "@/components/orders/order-detail-client";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
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
    include: orderDetailInclude,
  });
  if (!order) notFound();

  // §4.2 edit rule: privileged roles edit anytime (while editable); the
  // creator edits inside the window, then must request approval.
  const editWindowMinutes = await getOrderEditWindowMinutes();
  const privileged =
    permissions.includes("orders.edit") ||
    permissions.includes("orders.approve_edit");
  const isCreator = order.salesExecutiveId === session.user.id;
  const inWindow = withinEditWindow(order.createdAt, editWindowMinutes);
  const editableStatus = EDITABLE_STATUSES.includes(order.status);

  const canEdit = editableStatus && (privileged || (isCreator && inWindow));
  const canRequestEdit = editableStatus && isCreator && !inWindow && !privileged;
  const editBlockedReason =
    editableStatus && isCreator && !inWindow && !privileged
      ? `Edit window (${editWindowMinutes} min) has expired — changes need TL/Manager approval.`
      : null;

  const allowedTransitions = ALLOWED_TRANSITIONS[order.status].filter((to) =>
    statusChangePermitted(to, permissions)
  );

  return (
    <OrderDetailClient
      order={serializeOrderDetail(order, canSeeCosts(permissions))}
      canEdit={canEdit}
      editBlockedReason={editBlockedReason}
      canRequestEdit={canRequestEdit}
      canAddPayment={permissions.includes("payments.create")}
      canApprove={permissions.includes("orders.approve_edit")}
      allowedTransitions={allowedTransitions}
    />
  );
}
