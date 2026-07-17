import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import {
  getSteadfastIntegration,
  serializeIntegration,
} from "@/lib/steadfast-integration";
import { STEADFAST_COURIER_NAME } from "@/lib/steadfast-constants";
import { DELIVERY_ZONES } from "@/lib/order-constants";
import {
  getCourierOverchargeTolerancePct,
  getCourierStuckThresholds,
} from "@/lib/settings";
import {
  SteadfastCourierClient,
  type StatusLogRow,
  type ZoneRateRow,
} from "@/components/courier/steadfast-courier-client";

export const dynamic = "force-dynamic";

// The Courier page (CORRECTIONS Courier §2) — Steadfast only: the integration
// (moved here from Settings) plus the 3-zone courier cost rate config (§1).
// courier.manage roles run it day-to-day; API keys and the webhook token stay
// editable only with settings.manage (the client hides those controls).
export default async function CourierPage() {
  const session = await requirePagePermission("courier.manage");
  const permissions = await getEffectivePermissions(session.user.id);

  const [integration, logs, steadfastCourier, overchargeTolerancePct, stuck] =
    await Promise.all([
      getSteadfastIntegration(),
      prisma.shipmentStatusLog.findMany({
        orderBy: { receivedAt: "desc" },
        take: 15,
        include: { shipment: { select: { order: { select: { orderNo: true } } } } },
      }),
      prisma.courier.findUnique({
        where: { name: STEADFAST_COURIER_NAME },
        select: { zoneRates: true },
      }),
      getCourierOverchargeTolerancePct(),
      getCourierStuckThresholds(),
    ]);

  // Callback URL host: NEXTAUTH_URL if set, else the request's own origin.
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const base =
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ||
    (host ? `${proto}://${host}` : "");
  const callbackUrl = `${base}/api/webhooks/steadfast`;

  const logRows: StatusLogRow[] = logs.map((l) => ({
    id: l.id,
    source: l.source,
    rawStatus: l.rawStatus,
    receivedAt: l.receivedAt.toISOString(),
    orderNo: l.shipment?.order.orderNo ?? null,
  }));

  const zoneRates: ZoneRateRow[] = DELIVERY_ZONES.map((zone) => {
    const row = steadfastCourier?.zoneRates.find((r) => r.zone === zone);
    return {
      zone,
      baseRate: row ? Number(row.baseRate) : 0,
      perKgRate: row ? Number(row.perKgRate) : 0,
    };
  });

  return (
    <SteadfastCourierClient
      initial={serializeIntegration(integration, { callbackUrl })}
      logs={logRows}
      zoneRates={zoneRates}
      overchargeTolerancePct={overchargeTolerancePct}
      stuckAmberDays={stuck.amberDays}
      stuckRedDays={stuck.redDays}
      canManageKeys={permissions.includes("settings.manage")}
    />
  );
}
