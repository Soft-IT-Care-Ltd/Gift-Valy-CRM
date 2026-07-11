import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { orderScopeWhere, orderViewScope } from "@/lib/orders";
import { buildCancelledReport } from "@/lib/order-reports";
import { CancelledReportClient } from "@/components/reports/cancelled-report-client";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// R11 — Cancelled/Returned analysis (SPEC §12): reasons, value lost, SE-wise.
// Role scope via orderScopeWhere (SE own, TL team, Manager/Admin all).
export default async function CancelledReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; seId?: string }>;
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

  const report = await buildCancelledReport({ from, to, orderWhere, seId });

  let seOptions: { id: number; name: string }[] = [];
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
    seOptions = await prisma.user.findMany({
      where,
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  }

  return (
    <CancelledReportClient
      report={report}
      seOptions={seOptions}
      filters={{
        from: sp.from ?? "",
        to: sp.to ?? "",
        seId: seId ? String(seId) : "ALL",
      }}
    />
  );
}
