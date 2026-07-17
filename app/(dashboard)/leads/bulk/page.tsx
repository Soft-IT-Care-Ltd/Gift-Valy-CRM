import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { getLeadFormOptions, leadScopeWhere } from "@/lib/leads";
import { LeadBulkClient } from "@/components/leads/lead-bulk-client";

export const dynamic = "force-dynamic";

// Bulk Lead entry page (CORRECTIONS Leads §7) — daily per-source counts,
// visible only to leads.bulk holders (the list shows its button likewise).
export default async function BulkLeadPage() {
  const session = await requirePagePermission("leads.bulk");
  const permissions = await getEffectivePermissions(session.user.id);
  const scope = await leadScopeWhere(session, permissions);
  const options = await getLeadFormOptions(scope);

  return <LeadBulkClient campaigns={options.campaigns} />;
}
