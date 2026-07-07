import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getSteadfastIntegration, serializeIntegration } from "@/lib/steadfast-integration";
import {
  SteadfastSettingsClient,
  type StatusLogRow,
} from "@/components/settings/steadfast-settings-client";

export const dynamic = "force-dynamic";

// Settings → Courier Integrations → Steadfast (STEADFAST_INTEGRATION.md §1).
// Admin-only (settings.manage).
export default async function SteadfastSettingsPage() {
  await requirePagePermission("settings.manage");

  const [integration, logs] = await Promise.all([
    getSteadfastIntegration(),
    prisma.shipmentStatusLog.findMany({
      orderBy: { receivedAt: "desc" },
      take: 15,
      include: { shipment: { select: { order: { select: { orderNo: true } } } } },
    }),
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

  return (
    <SteadfastSettingsClient
      initial={serializeIntegration(integration, { callbackUrl })}
      logs={logRows}
    />
  );
}
