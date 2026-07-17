import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { canSeeCosts } from "@/lib/catalog";
import {
  ORDER_PAGE_SIZE,
  buildOrderListFilters,
  orderListInclude,
  orderScopeWhere,
  orderViewScope,
  serializeOrderListRow,
} from "@/lib/orders";
import { type OrderStatusValue } from "@/lib/order-constants";
import { getSteadfastIntegration } from "@/lib/steadfast-integration";
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
  // window/search/SE selection across ALL statuses — and the active tab's
  // count doubles as the pagination total (no extra COUNT query).
  const { baseFilters, filters, trashFilters, page, status, q, rangeAll, trash } =
    buildOrderListFilters(params, scope);

  // Trash tab (CORRECTIONS Orders §6f) — visible only with orders.trash.
  const canTrash = permissions.includes("orders.trash");

  const [orders, grouped, trashCount] = await Promise.all([
    prisma.order.findMany({
      where: { AND: filters },
      orderBy: trash ? { deletedAt: "desc" } : { createdAt: "desc" },
      skip: (page - 1) * ORDER_PAGE_SIZE,
      take: ORDER_PAGE_SIZE,
      include: orderListInclude,
    }),
    prisma.order.groupBy({
      by: ["status"],
      where: { AND: baseFilters },
      _count: { _all: true },
    }),
    canTrash
      ? prisma.order.count({ where: { AND: trashFilters } })
      : Promise.resolve(0),
  ]);
  const statusCounts = Object.fromEntries(
    grouped.map((g) => [g.status, g._count._all])
  ) as Partial<Record<OrderStatusValue, number>>;
  const total = trash
    ? trashCount
    : status
      ? (statusCounts[status] ?? 0)
      : Object.values(statusCounts).reduce((s, n) => s + (n ?? 0), 0);

  // "Send to Steadfast" on the CONFIRMED + PACKED tabs needs courier.manage +
  // an enabled integration (STEADFAST_INTEGRATION.md §2 + CORRECTIONS §6j).
  const canManageCourier = permissions.includes("courier.manage");
  const steadfastEnabled = canManageCourier
    ? ((await getSteadfastIntegration())?.isEnabled ?? false)
    : false;

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

  // The In Transit tab's Steadfast Delivery Charge column is a COST — only
  // cost-visible roles receive it (CLAUDE.md rule 1; stripped in the payload).
  const showCosts = canSeeCosts(permissions);

  return (
    <OrdersListClient
      orders={orders.map((o) => serializeOrderListRow(o, { showCosts }))}
      statusCounts={statusCounts}
      trashCount={trashCount}
      total={total}
      page={page}
      pageSize={ORDER_PAGE_SIZE}
      q={q}
      rangeAll={rangeAll}
      seOptions={seOptions}
      canCreate={permissions.includes("orders.create")}
      canManageCourier={canManageCourier}
      steadfastEnabled={steadfastEnabled}
      canTrash={canTrash}
      canEditOrders={permissions.includes("orders.edit")}
      canCancelOrders={permissions.includes("orders.cancel")}
      canPackOrders={permissions.includes("orders.pack")}
      canPrintInvoices={permissions.includes("invoice.generate")}
      canSeeCosts={showCosts}
    />
  );
}
