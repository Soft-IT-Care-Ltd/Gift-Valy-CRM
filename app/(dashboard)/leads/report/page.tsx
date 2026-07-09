import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { leadScopeWhere, leadViewScope, dailyCountScopeWhere } from "@/lib/leads";
import { buildLeadReport } from "@/lib/reports";
import { LEAD_SOURCES, type LeadSourceValue } from "@/lib/lead-constants";
import { LeadReportClient } from "@/components/reports/lead-report-client";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// R2 — Lead report (SPEC §3.2 / §12): leads by SE/source/campaign/date,
// conversion %, lost-reason breakdown. Respects role scope.
export default async function LeadReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    seId?: string;
    source?: string;
    campaign?: string;
  }>;
}) {
  const session = await requirePagePermission("leads.view_own");
  const permissions = await getEffectivePermissions(session.user.id);
  const sp = await searchParams;

  const [leadWhere, dailyCountWhere] = await Promise.all([
    leadScopeWhere(session, permissions),
    dailyCountScopeWhere(session, permissions),
  ]);
  const viewScope = leadViewScope(permissions);

  const from = sp.from && DATE_RE.test(sp.from) ? new Date(`${sp.from}T00:00:00+06:00`) : undefined;
  const to = sp.to && DATE_RE.test(sp.to) ? new Date(`${sp.to}T23:59:59+06:00`) : undefined;
  const seId = Number(sp.seId) || undefined;
  const source =
    sp.source && LEAD_SOURCES.includes(sp.source as LeadSourceValue)
      ? (sp.source as LeadSourceValue)
      : undefined;
  const campaign = sp.campaign?.trim() || undefined;

  const report = await buildLeadReport({
    from,
    to,
    leadWhere,
    dailyCountWhere,
    seId,
    source,
    campaign,
  });

  // SE filter options — only meaningful above own-scope.
  let seOptions: { id: number; name: string }[] = [];
  if (viewScope && viewScope !== "own") {
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { teamId: true, leaderOf: { select: { id: true } } },
    });
    const teamIds = [...(me.teamId ? [me.teamId] : []), ...me.leaderOf.map((t) => t.id)];
    const where: Prisma.UserWhereInput =
      viewScope === "all"
        ? { isActive: true, role: { name: { in: ["SalesExecutive", "TeamLeader", "Manager"] } } }
        : { isActive: true, OR: [{ id: session.user.id }, { teamId: { in: teamIds } }] };
    seOptions = await prisma.user.findMany({
      where,
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  }

  return (
    <LeadReportClient
      report={report}
      seOptions={seOptions}
      filters={{
        from: sp.from ?? "",
        to: sp.to ?? "",
        seId: seId ? String(seId) : "ALL",
        source: source ?? "ALL",
        campaign: campaign ?? "",
      }}
    />
  );
}
