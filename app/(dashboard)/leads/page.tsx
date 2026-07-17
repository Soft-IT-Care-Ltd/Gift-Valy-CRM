import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import {
  buildCommittedQueue,
  buildFollowUps,
  buildLeadListFilters,
  dailyCountScopeWhere,
  getAssignableUsers,
  getLeadFormOptions,
  leadScopeWhere,
  serializeLead,
  LEAD_INCLUDE,
} from "@/lib/leads";
import { OPEN_LEAD_STATUSES } from "@/lib/lead-constants";
import { dhakaDayStart } from "@/lib/orders";
import { LeadsListClient } from "@/components/leads/leads-list-client";

export const dynamic = "force-dynamic";

// Leads landing = the LIST (CORRECTIONS Leads §7), restructured like Orders:
// entry lives on /leads/new (and /leads/bulk), the window defaults to the
// current Dhaka month and the list is paginated server-side (§4). Scope
// follows §2.2 (SE own / TL team / all).
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePagePermission("leads.view_own");
  const permissions = await getEffectivePermissions(session.user.id);
  const params = await searchParams;

  const scope = await leadScopeWhere(session, permissions);
  const { filters, bulkFilters, page, size, q, rangeAll } =
    buildLeadListFilters(params, scope);
  const dcScope = await dailyCountScopeWhere(session, permissions);

  const [leadsRaw, total, bulkAgg, committed, followUps, options, assignable] =
    await Promise.all([
      prisma.lead.findMany({
        where: { AND: filters },
        include: LEAD_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * size,
        take: size,
      }),
      prisma.lead.count({ where: { AND: filters } }),
      // Bulk daily counts in the same window/source/SE — the §6 combined total.
      prisma.leadDailyCount.aggregate({
        _sum: { count: true },
        where: { AND: [dcScope, ...bulkFilters] },
      }),
      buildCommittedQueue(scope),
      buildFollowUps(scope),
      getLeadFormOptions(scope),
      getAssignableUsers(session, permissions),
    ]);

  // Overdue = follow-up before today (Dhaka) on a still-open lead — computed
  // over the page rows, so pagination can't hide a red flag.
  const dayStart = dhakaDayStart();
  const overdueLeadIds = leadsRaw
    .filter(
      (l) =>
        l.followUpAt &&
        l.followUpAt < dayStart &&
        (OPEN_LEAD_STATUSES as string[]).includes(l.status)
    )
    .map((l) => l.id);

  return (
    <LeadsListClient
      leads={leadsRaw.map(serializeLead)}
      committed={committed}
      todayCount={followUps.todayCount}
      overdueCount={followUps.overdueCount}
      overdueLeadIds={overdueLeadIds}
      bulkCount={bulkAgg._sum.count ?? 0}
      total={total}
      page={page}
      size={size}
      q={q}
      rangeAll={rangeAll}
      catalog={options.catalog}
      assignableUsers={assignable}
      campaigns={options.campaigns}
      canCreate={permissions.includes("leads.create")}
      canBulk={permissions.includes("leads.bulk")}
      canReassign={permissions.includes("leads.reassign")}
      canConvert={permissions.includes("orders.create")}
      me={{ id: session.user.id, name: session.user.name ?? "" }}
    />
  );
}
