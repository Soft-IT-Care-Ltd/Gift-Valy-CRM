import type { Prisma } from "@prisma/client";
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
import {
  COURIER_STATUSES,
  type CourierStatusValue,
  type ReturnSubTabValue,
} from "@/lib/courier-constants";
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

  // ---- Sub-tabs (CORRECTIONS Orders §6m/§6n) ----
  // In Transit: 4 courier-status sub-tabs; a shipment with no sub-state yet
  // (manual entry, pre-C6 rows) counts as PENDING. Returned: Pending (not yet
  // physically back) / Received (inspected). Sub filters ride on top of the
  // status filter; the active sub count doubles as the pagination total.
  const transitSub =
    status === "IN_TRANSIT" &&
    COURIER_STATUSES.includes(params.sub as CourierStatusValue)
      ? (params.sub as CourierStatusValue)
      : null;
  const returnedSub: ReturnSubTabValue | null =
    status === "RETURNED"
      ? params.sub === "received"
        ? "received"
        : "pending"
      : null;

  const noShipmentOrNoSubState: Prisma.OrderWhereInput = {
    OR: [
      { shipment: { is: null } },
      { shipment: { is: { courierStatus: null } } },
      { shipment: { is: { courierStatus: "PENDING" } } },
    ],
  };
  if (transitSub) {
    filters.push(
      transitSub === "PENDING"
        ? noShipmentOrNoSubState
        : { shipment: { is: { courierStatus: transitSub } } }
    );
  }
  const returnedPendingWhere: Prisma.OrderWhereInput = {
    OR: [
      { shipment: { is: null } },
      { shipment: { is: { returnReceivedAt: null } } },
    ],
  };
  const returnedReceivedWhere: Prisma.OrderWhereInput = {
    shipment: { is: { returnReceivedAt: { not: null } } },
  };
  if (returnedSub) {
    filters.push(
      returnedSub === "pending" ? returnedPendingWhere : returnedReceivedWhere
    );
  }

  const [orders, grouped, trashCount, transitGrouped, returnedPendingCount, returnedReceivedCount] =
    await Promise.all([
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
      // §6m sub-tab counts — shipment-level groupBy, so the lib/db.ts order
      // trash auto-filter does NOT apply; deletedAt is filtered explicitly.
      status === "IN_TRANSIT"
        ? prisma.shipment.groupBy({
            by: ["courierStatus"],
            where: {
              order: {
                is: {
                  AND: [...baseFilters, { status: "IN_TRANSIT" }, { deletedAt: null }],
                },
              },
            },
            _count: { _all: true },
          })
        : Promise.resolve(null),
      status === "RETURNED"
        ? prisma.order.count({
            where: { AND: [...baseFilters, { status: "RETURNED" }, returnedPendingWhere] },
          })
        : Promise.resolve(0),
      status === "RETURNED"
        ? prisma.order.count({
            where: { AND: [...baseFilters, { status: "RETURNED" }, returnedReceivedWhere] },
          })
        : Promise.resolve(0),
    ]);
  const statusCounts = Object.fromEntries(
    grouped.map((g) => [g.status, g._count._all])
  ) as Partial<Record<OrderStatusValue, number>>;

  let transitSubCounts: Record<CourierStatusValue, number> | null = null;
  if (transitGrouped) {
    transitSubCounts = {
      PENDING: 0,
      ASSIGNED: 0,
      DELIVERY_APPROVAL_PENDING: 0,
      RETURN_APPROVAL_PENDING: 0,
    };
    for (const g of transitGrouped) {
      // No sub-state yet → Pending (§6m: pending = received at warehouse).
      transitSubCounts[g.courierStatus ?? "PENDING"] += g._count._all;
    }
    // Manual IN_TRANSIT orders without a shipment row belong to Pending too.
    const withShipment = transitGrouped.reduce((s, g) => s + g._count._all, 0);
    transitSubCounts.PENDING += Math.max(
      (statusCounts.IN_TRANSIT ?? 0) - withShipment,
      0
    );
  }
  const returnedSubCounts =
    status === "RETURNED"
      ? { pending: returnedPendingCount, received: returnedReceivedCount }
      : null;

  const total = trash
    ? trashCount
    : transitSub && transitSubCounts
      ? transitSubCounts[transitSub]
      : returnedSub && returnedSubCounts
        ? returnedSubCounts[returnedSub]
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
      transitSubCounts={transitSubCounts}
      returnedSubCounts={returnedSubCounts}
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
