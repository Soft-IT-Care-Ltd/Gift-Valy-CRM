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
import { STEADFAST_COURIER_NAME } from "@/lib/steadfast-constants";
import {
  getCourierOverchargeTolerancePct,
  getCourierStuckThresholds,
} from "@/lib/settings";
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

  // §6m/§R2 — "Pending" collects everything not in a later sub-state: no
  // shipment, no sub-state yet, an explicit PENDING, OR an ASSIGNED with no real
  // rider on record (which displayedCourierStatus renders as Pending). "Assigned"
  // therefore requires a stored rider, so the two always agree with the badge.
  const noShipmentOrNoSubState: Prisma.OrderWhereInput = {
    OR: [
      { shipment: { is: null } },
      { shipment: { is: { courierStatus: null } } },
      { shipment: { is: { courierStatus: "PENDING" } } },
      { shipment: { is: { courierStatus: "ASSIGNED", riderName: null } } },
    ],
  };
  const assignedWithRider: Prisma.OrderWhereInput = {
    shipment: { is: { courierStatus: "ASSIGNED", riderName: { not: null } } },
  };
  if (transitSub) {
    filters.push(
      transitSub === "PENDING"
        ? noShipmentOrNoSubState
        : transitSub === "ASSIGNED"
          ? assignedWithRider
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

  // §R6 — stuck-parcel filter/sort + thresholds. `stuck` = min whole days in the
  // current courier sub-status; when set (In Transit only) it narrows the tab to
  // parcels sitting that long and forces a longest-first sort. `sort=stuck` also
  // triggers longest-first without filtering.
  const now = Date.now();
  const stuckThresholds = await getCourierStuckThresholds();
  const stuckDaysRaw =
    status === "IN_TRANSIT" && params.stuck != null
      ? Math.round(Number(params.stuck))
      : NaN;
  const stuckFilterActive =
    Number.isFinite(stuckDaysRaw) && stuckDaysRaw >= 0;
  const stuckDays = stuckFilterActive ? stuckDaysRaw : 0;
  if (stuckFilterActive) {
    filters.push({
      shipment: {
        is: { courierStatusAt: { lte: new Date(now - stuckDays * 86_400_000) } },
      },
    });
  }
  const sortLongestFirst =
    status === "IN_TRANSIT" && (params.sort === "stuck" || stuckFilterActive);
  const orderBy: Prisma.OrderOrderByWithRelationInput = trash
    ? { deletedAt: "desc" }
    : sortLongestFirst
      ? { shipment: { courierStatusAt: "asc" } }
      : { createdAt: "desc" };

  const [
    orders,
    grouped,
    trashCount,
    transitGrouped,
    transitAssignedNoRider,
    returnedPendingCount,
    returnedReceivedCount,
    transitStuckCount,
    stuckFilteredTotal,
  ] =
    await Promise.all([
      prisma.order.findMany({
        where: { AND: filters },
        orderBy,
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
      // §R2 — ASSIGNED rows with no real rider are still "Pending" for the tabs;
      // count them so they can be moved from the Assigned tally to Pending.
      status === "IN_TRANSIT"
        ? prisma.shipment.count({
            where: {
              courierStatus: "ASSIGNED",
              riderName: null,
              order: {
                is: {
                  AND: [...baseFilters, { status: "IN_TRANSIT" }, { deletedAt: null }],
                },
              },
            },
          })
        : Promise.resolve(0),
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
      // §R6 — how many In Transit parcels are stuck (≥ amber days in the current
      // sub-status). Shipment-level count, so the lib/db.ts order trash filter
      // does not apply — deletedAt is excluded explicitly.
      status === "IN_TRANSIT"
        ? prisma.shipment.count({
            where: {
              courierStatusAt: {
                lte: new Date(now - stuckThresholds.amberDays * 86_400_000),
              },
              order: {
                is: {
                  AND: [...baseFilters, { status: "IN_TRANSIT" }, { deletedAt: null }],
                },
              },
            },
          })
        : Promise.resolve(0),
      // §R6 — when the stuck filter is active the visible set is narrowed, so the
      // pagination total must be the filtered count, not the whole-tab tally.
      stuckFilterActive
        ? prisma.order.count({ where: { AND: filters } })
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
    // §R2 — an ASSIGNED row with no real rider isn't truly assigned: move it from
    // the Assigned tally to Pending so the counts match the badge and filters.
    transitSubCounts.ASSIGNED -= transitAssignedNoRider;
    transitSubCounts.PENDING += transitAssignedNoRider;
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

  const total = stuckFilterActive
    ? stuckFilteredTotal
    : trash
      ? trashCount
      : transitSub && transitSubCounts
        ? transitSubCounts[transitSub]
        : returnedSub && returnedSubCounts
          ? returnedSubCounts[returnedSub]
          : status
            ? (statusCounts[status] ?? 0)
            : Object.values(statusCounts).reduce((s, n) => s + (n ?? 0), 0);

  // "Send to Steadfast" on the CONFIRMED + PACKED tabs needs courier.manage +
  // an enabled integration (STEADFAST_INTEGRATION.md §2 + CORRECTIONS §6j). The
  // integration also feeds the §R1 "Sync now" buttons' "last synced" hint.
  const canManageCourier = permissions.includes("courier.manage");
  const integration = canManageCourier ? await getSteadfastIntegration() : null;
  const steadfastEnabled = integration?.isEnabled ?? false;
  const steadfastLastSyncAt = integration?.lastSyncAt
    ? integration.lastSyncAt.toISOString()
    : null;
  // §R5 — manual courier-stage overrides + trash-from-any-status (Admin-only by
  // default via the dedicated permission).
  const canCourierOverride = permissions.includes("orders.courier_override");
  // §R4 — overcharge alert tolerance for the Ours-vs-Steadfast comparison.
  const overchargeTolerancePct = await getCourierOverchargeTolerancePct();
  // §2.7 — the Steadfast COD fee % feeds the In Transit deduction/net columns.
  const steadfastCourierRow = await prisma.courier.findUnique({
    where: { name: STEADFAST_COURIER_NAME },
    select: { codFeePercent: true },
  });
  const codFeePercent =
    steadfastCourierRow != null && Number(steadfastCourierRow.codFeePercent) > 0
      ? Number(steadfastCourierRow.codFeePercent)
      : 1;

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
      steadfastLastSyncAt={steadfastLastSyncAt}
      canCourierOverride={canCourierOverride}
      overchargeTolerancePct={overchargeTolerancePct}
      codFeePercent={codFeePercent}
      stuckAmberDays={stuckThresholds.amberDays}
      stuckRedDays={stuckThresholds.redDays}
      transitStuckCount={transitStuckCount}
      nowMs={now}
      canTrash={canTrash}
      canEditOrders={permissions.includes("orders.edit")}
      canCancelOrders={permissions.includes("orders.cancel")}
      canPackOrders={permissions.includes("orders.pack")}
      canPrintInvoices={permissions.includes("invoice.generate")}
      canSeeCosts={showCosts}
    />
  );
}
