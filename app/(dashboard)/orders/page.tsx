import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import {
  orderScopeWhere,
  orderViewScope,
  serializeOrderListRow,
} from "@/lib/orders";
import {
  ORDER_STATUSES,
  type OrderStatusValue,
} from "@/lib/order-constants";
import { OrdersListClient } from "@/components/orders/orders-list-client";

export const dynamic = "force-dynamic";

// Order list with filters (§4) — scope per role: SE own, TL team, Admin/Manager all.
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePagePermission("orders.view_own");
  const permissions = await getEffectivePermissions(session.user.id);
  const params = await searchParams;

  const scope = await orderScopeWhere(session, permissions);
  // Status stays out of the base filters: the tab counts reflect the current
  // date/SE selection across ALL statuses, so switching tabs never surprises.
  const baseFilters: Prisma.OrderWhereInput[] = [scope];
  if (params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from)) {
    baseFilters.push({ createdAt: { gte: new Date(`${params.from}T00:00:00+06:00`) } });
  }
  if (params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to)) {
    baseFilters.push({ createdAt: { lte: new Date(`${params.to}T23:59:59+06:00`) } });
  }
  const seId = Number(params.seId);
  if (seId) baseFilters.push({ salesExecutiveId: seId });

  const filters = [...baseFilters];
  const status = params.status;
  if (status && ORDER_STATUSES.includes(status as OrderStatusValue)) {
    filters.push({ status: status as OrderStatusValue });
  }

  const [orders, grouped] = await Promise.all([
    prisma.order.findMany({
      where: { AND: filters },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        customer: { select: { name: true, phoneForeign: true, country: true } },
        salesExecutive: { select: { id: true, name: true } },
      },
    }),
    prisma.order.groupBy({
      by: ["status"],
      where: { AND: baseFilters },
      _count: { _all: true },
    }),
  ]);
  const statusCounts = Object.fromEntries(
    grouped.map((g) => [g.status, g._count._all])
  ) as Partial<Record<OrderStatusValue, number>>;

  // SE filter dropdown only for team/all scopes — an SE never sees other SEs.
  const scopeLevel = orderViewScope(permissions);
  let seOptions: { id: number; name: string }[] = [];
  if (scopeLevel === "all") {
    seOptions = await prisma.user.findMany({
      where: { isActive: true, salesOrders: { some: {} } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  } else if (scopeLevel === "team") {
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { teamId: true, leaderOf: { select: { id: true } } },
    });
    const teamIds = [
      ...(me?.teamId ? [me.teamId] : []),
      ...(me?.leaderOf.map((t) => t.id) ?? []),
    ];
    seOptions = await prisma.user.findMany({
      where: { isActive: true, teamId: { in: teamIds } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  return (
    <OrdersListClient
      orders={orders.map(serializeOrderListRow)}
      statusCounts={statusCounts}
      seOptions={seOptions}
      canCreate={permissions.includes("orders.create")}
    />
  );
}
