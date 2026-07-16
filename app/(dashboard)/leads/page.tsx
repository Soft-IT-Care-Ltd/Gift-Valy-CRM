import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import {
  leadScopeWhere,
  leadViewScope,
  buildCommittedQueue,
  buildFollowUps,
  serializeLead,
  LEAD_INCLUDE,
} from "@/lib/leads";
import { AD_COST_CATEGORY } from "@/lib/expense-constants";
import {
  LeadsClient,
  type CatalogPick,
  type UserPick,
} from "@/components/leads/leads-client";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// SPEC §3 — Lead Management home: quick entry, bulk daily count, follow-up
// reminders and the scoped lead list. Scope follows §2.2 (SE own / TL team / all).
export default async function LeadsPage() {
  const session = await requirePagePermission("leads.view_own");
  const permissions = await getEffectivePermissions(session.user.id);
  const scope = await leadScopeWhere(session, permissions);
  const viewScope = leadViewScope(permissions);

  // Team ids for the assignable-user set (reassign targets + SE filter).
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { id: true, name: true, teamId: true, leaderOf: { select: { id: true } } },
  });
  const teamIds = [
    ...(me.teamId ? [me.teamId] : []),
    ...me.leaderOf.map((t) => t.id),
  ];

  let assignableWhere: Prisma.UserWhereInput;
  if (viewScope === "all") {
    assignableWhere = {
      isActive: true,
      role: { name: { in: ["SalesExecutive", "TeamLeader", "Manager"] } },
    };
  } else if (viewScope === "team") {
    assignableWhere = {
      isActive: true,
      OR: [{ id: me.id }, { teamId: { in: teamIds } }],
    };
  } else {
    assignableWhere = { id: me.id };
  }

  const [leadsRaw, committed, followUps, products, packages, adCampaigns, leadCampaigns, assignable] =
    await Promise.all([
      prisma.lead.findMany({
        where: scope,
        include: LEAD_INCLUDE,
        orderBy: { createdAt: "desc" },
        take: 300,
      }),
      buildCommittedQueue(scope),
      buildFollowUps(scope),
      // Interested-in picker = the sellable catalog — component-only packing
      // materials are excluded (CORRECTIONS Products §1).
      prisma.product.findMany({
        where: { isActive: true, productType: "SELLABLE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.package.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.expense.findMany({
        where: { category: { name: AD_COST_CATEGORY }, campaignName: { not: null } },
        select: { campaignName: true },
        distinct: ["campaignName"],
        take: 100,
      }),
      prisma.lead.findMany({
        where: { AND: [scope, { campaignName: { not: null } }] },
        select: { campaignName: true },
        distinct: ["campaignName"],
        take: 100,
      }),
      prisma.user.findMany({
        where: assignableWhere,
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);

  const catalog: CatalogPick[] = [
    ...packages.map((p) => ({ itemType: "PACKAGE" as const, id: p.id, name: p.name })),
    ...products.map((p) => ({ itemType: "PRODUCT" as const, id: p.id, name: p.name })),
  ];
  const campaigns = [
    ...new Set(
      [...adCampaigns, ...leadCampaigns]
        .map((c) => c.campaignName?.trim())
        .filter((c): c is string => !!c)
    ),
  ].sort((a, b) => a.localeCompare(b));

  const assignableUsers: UserPick[] = assignable.map((u) => ({ id: u.id, name: u.name }));

  return (
    <LeadsClient
      leads={leadsRaw.map(serializeLead)}
      committed={committed}
      todayCount={followUps.todayCount}
      overdueLeadIds={followUps.overdue.map((l) => l.id)}
      catalog={catalog}
      assignableUsers={assignableUsers}
      campaigns={campaigns}
      canReassign={permissions.includes("leads.reassign")}
      canConvert={permissions.includes("orders.create")}
      me={{ id: me.id, name: me.name }}
    />
  );
}
