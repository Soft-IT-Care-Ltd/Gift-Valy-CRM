import { requirePagePermission } from "@/lib/page-auth";
import { getAttendanceSettings } from "@/lib/attendance";
import { AttendanceSettingsClient } from "@/components/settings/attendance-settings-client";

export const dynamic = "force-dynamic";

// SPEC §11 — office-hours settings. Admin-only (settings.manage), like the other
// /settings pages.
export default async function AttendanceSettingsPage() {
  await requirePagePermission("settings.manage");
  const settings = await getAttendanceSettings();
  return <AttendanceSettingsClient initial={settings} />;
}
