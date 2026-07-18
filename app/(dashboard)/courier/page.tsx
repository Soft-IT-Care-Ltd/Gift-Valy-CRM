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
import { dhakaDayStart, dhakaMonthStart } from "@/lib/orders";
import {
  getCourierOverchargeTolerancePct,
  getCourierStuckThresholds,
  getSteadfastPayoutWalletId,
} from "@/lib/settings";
import { serializeSteadfastPayment } from "@/lib/steadfast-payments";
import type { WalletOption, WalletTypeValue } from "@/lib/wallet";
import {
  SteadfastCourierClient,
  type StatusLogRow,
  type ZoneRateRow,
} from "@/components/courier/steadfast-courier-client";
import type { PaidSummary } from "@/components/courier/steadfast-payments-card";

export const dynamic = "force-dynamic";

// Paid-payout roll-up since a moment (§R8 "Paid today/this range" summary).
async function paidSince(from: Date): Promise<PaidSummary> {
  const agg = await prisma.steadfastPayment.aggregate({
    where: { status: "PAID", paymentDate: { gte: from } },
    _sum: { netAmount: true, parcelCount: true },
    _count: true,
  });
  return {
    net: Math.round(Number(agg._sum.netAmount ?? 0) * 100) / 100,
    parcels: agg._sum.parcelCount ?? 0,
    payouts: agg._count,
  };
}

// The Courier page (CORRECTIONS Courier §2) — Steadfast only: the integration
// (moved here from Settings), the 3-zone courier cost rate config (§1) and the
// §R8 Steadfast Payments section (COD payout reconciliation).
// courier.manage roles run it day-to-day; API keys and the webhook token stay
// editable only with settings.manage (the client hides those controls).
export default async function CourierPage() {
  const session = await requirePagePermission("courier.manage");
  const permissions = await getEffectivePermissions(session.user.id);

  const [
    integration,
    logs,
    steadfastCourier,
    overchargeTolerancePct,
    stuck,
    paymentRows,
    walletRows,
    payoutWalletId,
    paidToday,
    paidThisMonth,
  ] = await Promise.all([
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
    // §R8 — the latest payouts, newest first (the list view).
    prisma.steadfastPayment.findMany({
      orderBy: [{ paymentDate: "desc" }, { id: "desc" }],
      take: 15,
      include: {
        items: { include: { order: { select: { id: true, orderNo: true } } } },
      },
    }),
    prisma.wallet.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
    getSteadfastPayoutWalletId(),
    paidSince(dhakaDayStart()),
    paidSince(dhakaMonthStart()),
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

  // §R8 — list rows keep only the roll-up (the expandable detail view fetches
  // the consignment breakdown from the [id] route on demand).
  const payments = paymentRows.map((p) => {
    const { items: _items, ...row } = serializeSteadfastPayment(p);
    return row;
  });
  const wallets: WalletOption[] = walletRows.map((w) => ({
    id: w.id,
    name: w.name,
    type: w.type as WalletTypeValue,
  }));

  return (
    <SteadfastCourierClient
      initial={serializeIntegration(integration, { callbackUrl })}
      logs={logRows}
      zoneRates={zoneRates}
      overchargeTolerancePct={overchargeTolerancePct}
      stuckAmberDays={stuck.amberDays}
      stuckRedDays={stuck.redDays}
      canManageKeys={permissions.includes("settings.manage")}
      payments={payments}
      wallets={wallets}
      payoutWalletId={payoutWalletId}
      paidToday={paidToday}
      paidThisMonth={paidThisMonth}
    />
  );
}
