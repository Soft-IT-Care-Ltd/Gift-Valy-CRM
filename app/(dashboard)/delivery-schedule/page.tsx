import { requirePagePermission } from "@/lib/page-auth";
import { buildDeliverySchedule } from "@/lib/delivery";
import {
  deliveryPeriodRange,
  detectDeliveryPeriod,
  type DeliveryPeriod,
} from "@/lib/delivery-schedule";
import { DeliveryScheduleClient } from "@/components/delivery/delivery-schedule-client";

export const dynamic = "force-dynamic";

// CORRECTIONS Orders §2/§3 — the Delivery Schedule view for Packing/Operations
// (and Admin/Manager, gated on orders.pack): date-grouped deliveries that still
// need to go out, ASAP in Today, fixed-date badges, and late-risk red flags.
export default async function DeliverySchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePagePermission("orders.pack");
  const params = await searchParams;

  // Resolve the window: a named preset, or an explicit custom from/to. Default
  // to the next 7 days so today + the upcoming week land on the first view.
  const rawFrom = params.from ?? "";
  const rawTo = params.to ?? "";
  const period: DeliveryPeriod =
    (params.period as DeliveryPeriod) ??
    detectDeliveryPeriod(rawFrom, rawTo, "next7");
  let from: string;
  let to: string;
  if (period === "custom" && rawFrom && rawTo) {
    from = rawFrom <= rawTo ? rawFrom : rawTo;
    to = rawFrom <= rawTo ? rawTo : rawFrom;
  } else {
    const range = deliveryPeriodRange(
      period === "custom" ? "next7" : period
    );
    from = range.from;
    to = range.to;
  }

  const data = await buildDeliverySchedule({ from, to });

  return (
    <DeliveryScheduleClient
      data={data}
      period={period === "custom" && !(rawFrom && rawTo) ? "next7" : period}
      from={from}
      to={to}
    />
  );
}
