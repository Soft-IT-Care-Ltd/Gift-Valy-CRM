import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { canSeeCosts } from "@/lib/catalog";
import { buildStockReport } from "@/lib/reports";
import { StockReportClient } from "@/components/reports/stock-report-client";

export const dynamic = "force-dynamic";

// R4 — Stock report (SPEC §12 / §6.3). Gated on stock.view (same as the Stock
// screen); avg cost & stock value are populated only for cost-visible roles
// (CLAUDE.md rule 1) — the numbers are stripped server-side before they reach
// the client, so a cost-blind role can't export them either.
export default async function StockReportPage() {
  const session = await requirePagePermission("stock.view");
  const permissions = await getEffectivePermissions(session.user.id);
  const showCosts = canSeeCosts(permissions);

  const { rows, totalStockValue, lowStockCount } = await buildStockReport(showCosts);

  return (
    <StockReportClient
      rows={rows}
      totalStockValue={totalStockValue}
      lowStockCount={lowStockCount}
      showCosts={showCosts}
    />
  );
}
