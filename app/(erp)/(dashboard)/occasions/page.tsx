import type { Prisma } from "@prisma/client";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { orderScopeWhere } from "@/lib/orders";
import { buildOccasionWindow } from "@/lib/occasions";
import { getOccasionReminderLeadDays } from "@/lib/settings";
import {
  detectOccasionPeriod,
  occasionPeriodRange,
  type OccasionPeriod,
} from "@/lib/occasion-constants";
import { OccasionsClient } from "@/components/occasions/occasions-client";

export const dynamic = "force-dynamic";

// CORRECTIONS Orders §7 (C8) — the Occasions menu: upcoming recipient birthdays
// & anniversaries (repeat-sale engine), gated on orders.view_own so any
// order-viewing role gets it; rows are scoped to the customers that role's
// orders reach (SE = own, TL = team, Manager/Admin = all).
export default async function OccasionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePagePermission("orders.view_own");
  const permissions = await getEffectivePermissions(session.user.id);
  const params = await searchParams;

  // Resolve the window: a named preset or an explicit custom range. Default to
  // the next 7 days (aligns with the default reminder lead time).
  const rawFrom = params.from ?? "";
  const rawTo = params.to ?? "";
  const period: OccasionPeriod =
    (params.period as OccasionPeriod) ??
    detectOccasionPeriod(rawFrom, rawTo, "next7");
  let from: string;
  let to: string;
  if (period === "custom" && rawFrom && rawTo) {
    from = rawFrom <= rawTo ? rawFrom : rawTo;
    to = rawFrom <= rawTo ? rawTo : rawFrom;
  } else {
    const range = occasionPeriodRange(period === "custom" ? "next7" : period);
    from = range.from;
    to = range.to;
  }

  // Customer scope: unfiltered for all-orders roles; otherwise only customers
  // this viewer's orders reach. Occasions carry no cost fields, so this is a
  // visibility scope, not a field-security one.
  const orderWhere = await orderScopeWhere(session, permissions);
  const scope: Prisma.CustomerWhereInput | undefined = permissions.includes(
    "orders.view_all"
  )
    ? undefined
    : { orders: { some: orderWhere } };

  const [rows, leadDays] = await Promise.all([
    buildOccasionWindow({ from, to, scope }),
    getOccasionReminderLeadDays(),
  ]);

  return (
    <OccasionsClient
      rows={rows}
      period={period === "custom" && !(rawFrom && rawTo) ? "next7" : period}
      from={from}
      to={to}
      canManage={permissions.includes("orders.create")}
      leadDays={leadDays}
    />
  );
}
