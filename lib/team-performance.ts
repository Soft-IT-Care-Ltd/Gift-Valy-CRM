import type { OrderStatus, Prisma, PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { prisma } from "./db";
import { AuthzError } from "./authz";
import { NON_SALE_STATUSES } from "./order-constants";
import { dhakaDateBound } from "./order-constants";
import { getOnboardingExcludeDays } from "./settings";
import {
  isOnboardingExcluded,
  monthDateKey,
  monthWindow,
} from "./targets";

type Tx = Prisma.TransactionClient | PrismaClient;

// ============ R3 — Team performance report (SPEC §12) ============
// Per SE: leads, conversion %, orders, sales value, avg order value, target %.
// Month-based (targets are monthly, SPEC §10). Scope comes from the dedicated
// reports.* permissions (seeded exactly per §2.2): SE (reports.own) sees only
// their own row, TL (reports.team) their team, Manager/Admin (reports.all) all
// sellers. Target columns respect §10 confidentiality: a confidential target is
// visible only to its subject and to an Admin. No cost fields (CLAUDE.md rule 1).

const round2 = (n: number) => Math.round(n * 100) / 100;
const SALE_STATUS_FILTER = { notIn: NON_SALE_STATUSES as unknown as OrderStatus[] };

export type ReportScope = "all" | "team" | "own";

export function reportViewScope(permissions: string[]): ReportScope | null {
  if (permissions.includes("reports.all")) return "all";
  if (permissions.includes("reports.team")) return "team";
  if (permissions.includes("reports.own")) return "own";
  return null;
}

export interface PerfTargetView {
  targetOrders: number | null;
  targetAmount: number | null;
  ordersPct: number | null; // achieved ÷ target, null when no order target
  amountPct: number | null;
  hidden: boolean; // confidential target the viewer may not see (row shows "•••")
}

export interface TeamPerfRow {
  userId: number;
  name: string;
  teamName: string | null;
  isOnboarding: boolean;
  leads: number;
  converted: number;
  conversionPct: number;
  orders: number; // sale orders (excl. cancelled/returned/refunded)
  salesValue: number;
  avgOrderValue: number;
  target: PerfTargetView | null; // null = no target set this month
}

export interface TeamPerfTeamRow {
  teamId: number;
  name: string;
  members: number;
  excludedOnboarding: number; // members outside aggregates (§10 onboarding grace)
  leads: number;
  converted: number;
  conversionPct: number;
  orders: number;
  salesValue: number;
  avgOrderValue: number;
  target: PerfTargetView | null;
}

export interface TeamPerformanceReport {
  monthKey: string; // YYYY-MM
  scope: ReportScope;
  rows: TeamPerfRow[]; // sales value desc
  teams: TeamPerfTeamRow[]; // only for team/all scope
}

function targetView(
  t: { targetOrders: number | null; targetAmount: unknown; isConfidential: boolean } | undefined,
  achieved: { orders: number; amount: number },
  viewerMaySee: boolean
): PerfTargetView | null {
  if (!t) return null;
  if (!viewerMaySee) {
    return {
      targetOrders: null,
      targetAmount: null,
      ordersPct: null,
      amountPct: null,
      hidden: true,
    };
  }
  const targetOrders = t.targetOrders;
  const targetAmount = t.targetAmount != null ? Number(t.targetAmount) : null;
  return {
    targetOrders,
    targetAmount,
    ordersPct:
      targetOrders != null && targetOrders > 0
        ? round2((achieved.orders / targetOrders) * 100)
        : null,
    amountPct:
      targetAmount != null && targetAmount > 0
        ? round2((achieved.amount / targetAmount) * 100)
        : null,
    hidden: false,
  };
}

export async function buildTeamPerformanceReport(
  session: Session,
  permissions: string[],
  monthKey: string,
  now: Date = new Date(),
  db: Tx = prisma
): Promise<TeamPerformanceReport> {
  const scope = reportViewScope(permissions);
  if (!scope) throw new AuthzError(403, "No report permission");
  const isAdmin = session.user.role === "Admin";

  // Who the viewer may see. Sellers = active SEs and TLs (same population as
  // the §10 leaderboard).
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, teamId: true, leaderOf: { select: { id: true } } },
  });
  const myTeamIds = [
    ...(me?.teamId ? [me.teamId] : []),
    ...(me?.leaderOf.map((t) => t.id) ?? []),
  ];

  const sellerWhere: Prisma.UserWhereInput =
    scope === "all"
      ? { isActive: true, role: { name: { in: ["SalesExecutive", "TeamLeader"] } } }
      : scope === "team"
        ? {
            isActive: true,
            role: { name: { in: ["SalesExecutive", "TeamLeader"] } },
            OR: [{ id: session.user.id }, { teamId: { in: myTeamIds } }],
          }
        : { id: session.user.id };

  const sellers = await db.user.findMany({
    where: sellerWhere,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      isOnboarding: true,
      joinedAt: true,
      teamId: true,
      team: { select: { id: true, name: true } },
    },
  });
  const sellerIds = sellers.map((s) => s.id);

  const { start, end } = monthWindow(monthKey);
  const monthDate = monthDateKey(monthKey);

  const [orderAgg, leadAgg, convertedAgg, userTargets] = await Promise.all([
    db.order.groupBy({
      by: ["salesExecutiveId"],
      where: {
        salesExecutiveId: { in: sellerIds },
        status: SALE_STATUS_FILTER,
        createdAt: { gte: start, lt: end },
      },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    // leadDate is @db.Date — bound on the Dhaka calendar day (see lib/order-constants).
    db.lead.groupBy({
      by: ["assignedTo"],
      where: {
        assignedTo: { in: sellerIds },
        leadDate: { gte: dhakaDateBound(start), lt: dhakaDateBound(end) },
      },
      _count: { _all: true },
    }),
    db.lead.groupBy({
      by: ["assignedTo"],
      where: {
        assignedTo: { in: sellerIds },
        leadDate: { gte: dhakaDateBound(start), lt: dhakaDateBound(end) },
        status: "CONVERTED",
      },
      _count: { _all: true },
    }),
    db.target.findMany({
      where: { scope: "USER", month: monthDate, userId: { in: sellerIds } },
      select: {
        userId: true,
        targetOrders: true,
        targetAmount: true,
        isConfidential: true,
      },
    }),
  ]);

  const orderBy = new Map(
    orderAgg.map((g) => [
      g.salesExecutiveId,
      { orders: g._count._all, amount: Number(g._sum.totalAmount ?? 0) },
    ])
  );
  const leadsBy = new Map(leadAgg.map((g) => [g.assignedTo, g._count._all]));
  const convBy = new Map(convertedAgg.map((g) => [g.assignedTo, g._count._all]));
  const targetBy = new Map(userTargets.map((t) => [t.userId, t]));

  const rows: TeamPerfRow[] = sellers.map((s) => {
    const achieved = orderBy.get(s.id) ?? { orders: 0, amount: 0 };
    const leads = leadsBy.get(s.id) ?? 0;
    const converted = convBy.get(s.id) ?? 0;
    const t = targetBy.get(s.id);
    // §10: confidential targets are for the subject and Admin only.
    const maySeeTarget = !t?.isConfidential || isAdmin || s.id === session.user.id;
    return {
      userId: s.id,
      name: s.name,
      teamName: s.team?.name ?? null,
      isOnboarding: s.isOnboarding,
      leads,
      converted,
      conversionPct: leads > 0 ? round2((converted / leads) * 100) : 0,
      orders: achieved.orders,
      salesValue: round2(achieved.amount),
      avgOrderValue:
        achieved.orders > 0 ? round2(achieved.amount / achieved.orders) : 0,
      target: targetView(t, achieved, maySeeTarget),
    };
  });
  rows.sort((a, b) => b.salesValue - a.salesValue || b.orders - a.orders);

  // ---------- team aggregates (team/all scope only) ----------
  let teams: TeamPerfTeamRow[] = [];
  if (scope !== "own") {
    const teamWhere: Prisma.TeamWhereInput =
      scope === "all" ? {} : { id: { in: myTeamIds } };
    const [teamList, days, teamTargets] = await Promise.all([
      db.team.findMany({
        where: teamWhere,
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          members: {
            select: { id: true, isOnboarding: true, joinedAt: true },
          },
        },
      }),
      getOnboardingExcludeDays(),
      db.target.findMany({
        where: { scope: "TEAM", month: monthDate },
        select: {
          teamId: true,
          targetOrders: true,
          targetAmount: true,
          isConfidential: true,
        },
      }),
    ]);
    const teamTargetBy = new Map(teamTargets.map((t) => [t.teamId, t]));

    teams = await Promise.all(
      teamList.map(async (team) => {
        // §10 — onboarding members inside the grace window don't count toward
        // team aggregates (same rule as the team gauge).
        const excluded = team.members
          .filter((m) => isOnboardingExcluded(m, now, days))
          .map((m) => m.id);
        const memberFilter = excluded.length
          ? { notIn: excluded }
          : undefined;

        const [orders, leads, converted] = await Promise.all([
          db.order.aggregate({
            where: {
              teamId: team.id,
              status: SALE_STATUS_FILTER,
              createdAt: { gte: start, lt: end },
              ...(memberFilter ? { salesExecutiveId: memberFilter } : {}),
            },
            _count: { _all: true },
            _sum: { totalAmount: true },
          }),
          db.lead.count({
            where: {
              teamId: team.id,
              leadDate: { gte: dhakaDateBound(start), lt: dhakaDateBound(end) },
              ...(memberFilter ? { assignedTo: memberFilter } : {}),
            },
          }),
          db.lead.count({
            where: {
              teamId: team.id,
              leadDate: { gte: dhakaDateBound(start), lt: dhakaDateBound(end) },
              status: "CONVERTED",
              ...(memberFilter ? { assignedTo: memberFilter } : {}),
            },
          }),
        ]);

        const amount = Number(orders._sum.totalAmount ?? 0);
        const count = orders._count._all;
        return {
          teamId: team.id,
          name: team.name,
          members: team.members.length,
          excludedOnboarding: excluded.length,
          leads,
          converted,
          conversionPct: leads > 0 ? round2((converted / leads) * 100) : 0,
          orders: count,
          salesValue: round2(amount),
          avgOrderValue: count > 0 ? round2(amount / count) : 0,
          target: targetView(
            teamTargetBy.get(team.id),
            { orders: count, amount },
            true // team targets have no per-member confidentiality (§10 gauges)
          ),
        };
      })
    );
    teams.sort((a, b) => b.salesValue - a.salesValue);
  }

  return { monthKey, scope, rows, teams };
}
