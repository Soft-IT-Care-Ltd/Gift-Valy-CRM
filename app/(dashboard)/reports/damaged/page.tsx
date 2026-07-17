import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { canSeeCosts } from "@/lib/catalog";
import { buildDamagedStockReport } from "@/lib/reports";
import { DamagedReportClient } from "@/components/reports/damaged-report-client";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// CORRECTIONS Orders §6n — Damaged stock report: every unit the receive-time
// inspection marked Damaged (never restocked; value at cost = P&L loss).
// Gated on stock.view like the other inventory reports; cost columns are
// stripped server-side for cost-blind roles (CLAUDE.md rule 1).
export default async function DamagedStockReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await requirePagePermission("stock.view");
  const permissions = await getEffectivePermissions(session.user.id);
  const showCosts = canSeeCosts(permissions);
  const sp = await searchParams;

  const from =
    sp.from && DATE_RE.test(sp.from)
      ? new Date(`${sp.from}T00:00:00+06:00`)
      : undefined;
  const to =
    sp.to && DATE_RE.test(sp.to)
      ? new Date(`${sp.to}T23:59:59+06:00`)
      : undefined;

  const report = await buildDamagedStockReport({ showCosts, from, to });
  return (
    <DamagedReportClient
      report={report}
      showCosts={showCosts}
      from={sp.from ?? ""}
      to={sp.to ?? ""}
    />
  );
}
