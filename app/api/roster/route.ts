import { NextResponse } from "next/server";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getRosterOverview, saveRosterWeek } from "@/lib/attendance";

// R10 — the weekly roster grid data (employees + version history + shifts).
// Admin-only (settings.manage).
export async function GET() {
  try {
    await requirePermission("settings.manage");
    return NextResponse.json(await getRosterOverview());
  } catch (e) {
    return apiError(e);
  }
}

// Save one employee's week as the roster version at the chosen effective date.
// Earlier versions are untouched (history preserved); a week saved as all
// "default" removes that version so the person falls back to office hours.
export async function PUT(req: Request) {
  try {
    const session = await requirePermission("settings.manage");
    const saved = await saveRosterWeek(await req.json(), session.user.id);
    await logAudit({
      userId: session.user.id,
      action: "roster.update",
      entity: "roster_assignments",
      entityId: saved.userId,
      after: saved,
    });
    return NextResponse.json(saved);
  } catch (e) {
    return apiError(e);
  }
}
