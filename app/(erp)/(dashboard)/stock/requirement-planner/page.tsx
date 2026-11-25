import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { canSeeCosts } from "@/lib/catalog";
import { buildRequirementPlan } from "@/lib/requirement-planner";
import {
  deliveryPeriodRange,
  detectDeliveryPeriod,
  type DeliveryPeriod,
} from "@/lib/delivery-schedule";
import { RequirementPlannerClient } from "@/components/delivery/requirement-planner-client";

export const dynamic = "force-dynamic";

// CORRECTIONS Stock/Purchase §1 — the Delivery Requirement Planner (Admin,
// Manager, Accounts, Owner). purchases.create is a cost-privileged permission by
// role design, so the unit-cost / purchase-amount columns render here. The
// planner is inherently a costing tool — a role that can't see costs is blocked.
export default async function RequirementPlannerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePagePermission("purchases.create");
  const permissions = await getEffectivePermissions(session.user.id);
  const showCosts = canSeeCosts(permissions);
  const params = await searchParams;

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
    const range = deliveryPeriodRange(period === "custom" ? "next7" : period);
    from = range.from;
    to = range.to;
  }

  const includeDrafts = params.drafts === "1";
  const plan = await buildRequirementPlan({ from, to, includeDrafts });

  return (
    <RequirementPlannerClient
      plan={plan}
      period={period === "custom" && !(rawFrom && rawTo) ? "next7" : period}
      from={from}
      to={to}
      showCosts={showCosts}
    />
  );
}
