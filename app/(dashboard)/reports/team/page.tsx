import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { buildTeamPerformanceReport } from "@/lib/team-performance";
import { TeamPerformanceClient } from "@/components/reports/team-performance-client";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Current month key (YYYY-MM) on the Dhaka calendar.
function dhakaMonthKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

// R3 — Team performance (SPEC §12): per SE leads, conversion, orders, sales
// value, avg order value, target %. Month-based because targets are monthly
// (§10). Scope: reports.own = self, reports.team = team, reports.all = all.
export default async function TeamPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await requirePagePermission("reports.own");
  const permissions = await getEffectivePermissions(session.user.id);
  const sp = await searchParams;

  const monthKey =
    sp.month && MONTH_RE.test(sp.month) ? sp.month : dhakaMonthKey();

  const report = await buildTeamPerformanceReport(
    session,
    permissions,
    monthKey
  );

  return <TeamPerformanceClient report={report} />;
}
