import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import {
  getAssignableUsers,
  getLeadFormOptions,
  leadScopeWhere,
} from "@/lib/leads";
import { LeadNewClient } from "@/components/leads/lead-new-client";

export const dynamic = "force-dynamic";

// New Lead entry page (CORRECTIONS Leads §7) — split out of the list landing.
// WhatsApp-first field order, country auto-detect and the §3 defaults live in
// the client; §8 assign-on-entry shows only for leads.reassign holders.
export default async function NewLeadPage() {
  const session = await requirePagePermission("leads.create");
  const permissions = await getEffectivePermissions(session.user.id);
  const scope = await leadScopeWhere(session, permissions);

  const canAssign = permissions.includes("leads.reassign");
  const [options, assignable] = await Promise.all([
    getLeadFormOptions(scope),
    canAssign ? getAssignableUsers(session, permissions) : Promise.resolve([]),
  ]);

  return (
    <LeadNewClient
      catalog={options.catalog}
      campaigns={options.campaigns}
      assignableUsers={assignable}
      canAssign={canAssign}
      me={{ id: session.user.id, name: session.user.name ?? "" }}
    />
  );
}
