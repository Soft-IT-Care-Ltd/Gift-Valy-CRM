import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { orderScopeWhere, orderViewScope } from "@/lib/orders";
import { buildSalesReport } from "@/lib/order-reports";
import { SalesReportClient } from "@/components/reports/sales-report-client";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// R1 — Sales report (SPEC §4 / §12): orders & value by day/SE/team/package/
// country, delivered vs cancelled. Role scope via orderScopeWhere (SE own,
// TL team, Manager/Admin all). No cost fields.
export default async function SalesReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    seId?: string;
    teamId?: string;
  }>;
}) {
  const session = await requirePagePermission("orders.view_own");
  const permissions = await getEffectivePermissions(session.user.id);
  const sp = await searchParams;

  const orderWhere = await orderScopeWhere(session, permissions);
  const viewScope = orderViewScope(permissions);

  const from =
    sp.from && DATE_RE.test(sp.from)
      ? new Date(`${sp.from}T00:00:00+06:00`)
      : undefined;
  const to =
    sp.to && DATE_RE.test(sp.to)
      ? new Date(`${sp.to}T23:59:59+06:00`)
      : undefined;
  const seId = Number(sp.seId) || undefined;
  const teamId = Number(sp.teamId) || undefined;

  const report = await buildSalesReport({ from, to, orderWhere, seId, teamId });

  // SE / team filter options — only meaningful above own-scope (mirrors R2).
  let seOptions: { id: number; name: string }[] = [];
  let teamOptions: { id: number; name: string }[] = [];
  if (viewScope && viewScope !== "own") {
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { teamId: true, leaderOf: { select: { id: true } } },
    });
    const teamIds = [
      ...(me.teamId ? [me.teamId] : []),
      ...me.leaderOf.map((t) => t.id),
    ];
    const where: Prisma.UserWhereInput =
      viewScope === "all"
        ? {
            isActive: true,
            role: { name: { in: ["SalesExecutive", "TeamLeader", "Manager"] } },
          }
        : {
            isActive: true,
            OR: [{ id: session.user.id }, { teamId: { in: teamIds } }],
          };
    [seOptions, teamOptions] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.team.findMany({
        where: viewScope === "all" ? {} : { id: { in: teamIds } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
  }

  return (
    <SalesReportClient
      report={report}
      seOptions={seOptions}
      teamOptions={teamOptions}
      filters={{
        from: sp.from ?? "",
        to: sp.to ?? "",
        seId: seId ? String(seId) : "ALL",
        teamId: teamId ? String(teamId) : "ALL",
      }}
    />
  );
}
