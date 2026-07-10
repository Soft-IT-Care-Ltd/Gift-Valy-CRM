import { NextResponse } from "next/server";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { checkOut } from "@/lib/attendance";
import { serializeAttendance } from "@/lib/attendance-constants";

// SPEC §11 — check-out button. Server-side timestamp; requires a prior check-in.
export async function POST() {
  try {
    const session = await requirePermission("attendance.own");
    const row = await checkOut(session.user.id, new Date());
    await logAudit({
      userId: session.user.id,
      action: "attendance.check_out",
      entity: "attendance",
      entityId: row.id,
      after: { date: row.date.toISOString().slice(0, 10) },
    });
    return NextResponse.json(serializeAttendance(row));
  } catch (e) {
    return apiError(e);
  }
}
