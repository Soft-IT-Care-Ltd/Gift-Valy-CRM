import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { canSeeCosts } from "@/lib/catalog";
import { buildPackageReport } from "@/lib/reports";
import { PackageReportClient } from "@/components/reports/package-report-client";

export const dynamic = "force-dynamic";

// R5 — Package availability (SPEC §12 / §6.2). Buildable qty is stock-derived,
// so it shares the stock.view gate; package cost & margin ride along only for
// cost-visible roles (CLAUDE.md rule 1).
export default async function PackageReportPage() {
  const session = await requirePagePermission("stock.view");
  const permissions = await getEffectivePermissions(session.user.id);
  const showCosts = canSeeCosts(permissions);

  const { rows } = await buildPackageReport(showCosts);

  return <PackageReportClient rows={rows} showCosts={showCosts} />;
}
