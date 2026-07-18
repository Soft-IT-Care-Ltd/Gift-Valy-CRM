import { requirePagePermission } from "@/lib/page-auth";
import { getRosterOverview, getAttendanceSettings } from "@/lib/attendance";
import { dhakaYmd } from "@/lib/attendance-constants";
import { RosterClient } from "@/components/settings/roster-client";

export const dynamic = "force-dynamic";

// R10 — shift definitions + the weekly roster grid. Admin-only
// (settings.manage), like the office-hours page it extends.
export default async function RosterSettingsPage() {
  await requirePagePermission("settings.manage");
  const [{ employees, shifts }, settings] = await Promise.all([
    getRosterOverview(),
    getAttendanceSettings(),
  ]);
  return (
    <RosterClient
      shifts={shifts}
      employees={employees}
      today={dhakaYmd(new Date())}
      defaultHours={`${settings.officeStart}–${settings.officeEnd}`}
    />
  );
}
