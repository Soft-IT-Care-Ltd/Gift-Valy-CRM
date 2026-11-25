import { requirePagePermission } from "@/lib/page-auth";
import { getPnlSettings } from "@/lib/pnl";
import { PnlSettingsClient } from "@/components/settings/pnl-settings-client";

export const dynamic = "force-dynamic";

// SPEC §9.2 — packaging cost + ad-cost allocation method. Admin-only
// (settings.manage), like the other /settings pages.
export default async function PnlSettingsPage() {
  await requirePagePermission("settings.manage");
  const settings = await getPnlSettings();
  return <PnlSettingsClient initial={settings} />;
}
