import { NextResponse } from "next/server";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getAttendanceSettings, saveAttendanceSettings } from "@/lib/attendance";

// SPEC §11 — office hours & late threshold live in settings. Admin-only
// (settings.manage), same gate as the other /settings pages.
export async function GET() {
  try {
    await requirePermission("settings.manage");
    return NextResponse.json(await getAttendanceSettings());
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requirePermission("settings.manage");
    const settings = await saveAttendanceSettings(await req.json());
    await logAudit({
      userId: session.user.id,
      action: "settings.update",
      entity: "settings",
      entityId: "attendance_settings",
      after: settings,
    });
    return NextResponse.json(settings);
  } catch (e) {
    return apiError(e);
  }
}
