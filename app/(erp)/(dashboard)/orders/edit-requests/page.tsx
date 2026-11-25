import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { orderScopeWhere } from "@/lib/orders";
import { EditRequestsClient } from "@/components/orders/edit-requests-client";

export const dynamic = "force-dynamic";

// Approval queue (§4.2) — TL sees team requests, Manager/Admin see all.
export default async function EditRequestsPage() {
  const session = await requirePagePermission("orders.approve_edit");
  const permissions = await getEffectivePermissions(session.user.id);
  const scope = await orderScopeWhere(session, permissions);

  const requests = await prisma.orderEditRequest.findMany({
    where: { status: "PENDING", order: scope },
    orderBy: { createdAt: "asc" },
    include: {
      order: { select: { id: true, orderNo: true } },
      requester: { select: { name: true } },
    },
  });

  return (
    <EditRequestsClient
      requests={requests.map((r) => ({
        id: r.id,
        orderId: r.order.id,
        orderNo: r.order.orderNo,
        requestedBy: r.requester.name,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      }))}
    />
  );
}
