import { requirePagePermission } from "@/lib/page-auth";
import { getOccasionReminderLeadDays } from "@/lib/settings";
import { OccasionSettingsClient } from "@/components/settings/occasion-settings-client";

export const dynamic = "force-dynamic";

// CORRECTIONS Orders §7 (C8) — configurable occasion reminder lead time.
// Admin-only (settings.manage), like the other /settings pages.
export default async function OccasionSettingsPage() {
  await requirePagePermission("settings.manage");
  const leadDays = await getOccasionReminderLeadDays();
  return <OccasionSettingsClient initial={leadDays} />;
}
