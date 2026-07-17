import Link from "next/link";
import { countLateRiskDeliveries, countStuckParcels } from "@/lib/delivery";

// CORRECTIONS Orders §3 + §R6 — the two operations "impossible to miss" counts on
// the dashboard: fixed-date deliveries at risk (for packing roles) and parcels
// stuck in transit (for courier roles). Each is a deep-link to the screen that
// resolves it. Renders nothing when the viewer holds neither permission or both
// counts are zero, so a healthy dashboard stays clean.
export async function OperationsAlerts({
  permissions,
}: {
  permissions: string[];
}) {
  const canPack = permissions.includes("orders.pack");
  const canCourier = permissions.includes("courier.manage");
  if (!canPack && !canCourier) return null;

  const [lateRisk, stuck] = await Promise.all([
    canPack ? countLateRiskDeliveries() : Promise.resolve(0),
    canCourier
      ? countStuckParcels()
      : Promise.resolve({ count: 0, thresholdDays: 0 }),
  ]);

  if (lateRisk === 0 && stuck.count === 0) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {canPack && lateRisk > 0 && (
        <Link
          href="/delivery-schedule?period=tomorrow"
          className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700 transition-colors hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60"
        >
          <span className="text-lg">⚠</span>
          <span>
            <span className="font-semibold">
              {lateRisk} fixed-date deliver{lateRisk === 1 ? "y" : "ies"} at risk
            </span>
            <span className="ml-1 text-red-600/80 dark:text-red-400/80">
              — due today/tomorrow, not packed. Open the Delivery Schedule →
            </span>
          </span>
        </Link>
      )}
      {canCourier && stuck.count > 0 && (
        <Link
          href={`/orders?status=IN_TRANSIT&stuck=${stuck.thresholdDays}&sort=stuck`}
          className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60"
        >
          <span className="text-lg">⏳</span>
          <span>
            <span className="font-semibold">
              {stuck.count} parcel{stuck.count === 1 ? "" : "s"} stuck in transit
            </span>
            <span className="ml-1 text-amber-700/80 dark:text-amber-400/80">
              — ≥ {stuck.thresholdDays}d in one courier status. Review In Transit →
            </span>
          </span>
        </Link>
      )}
    </div>
  );
}
