import { NextResponse } from "next/server";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { checkIn } from "@/lib/attendance";
import { serializeAttendance } from "@/lib/attendance-constants";

// SPEC §11 — check-in button. Timestamp is server-side (the request time), never
// trusted from the client. Auto-flags Late/Half-day from office-hours settings.
export async function POST() {
  try {
    const session = await requirePermission("attendance.own");
    const row = await checkIn(session.user.id, new Date());
    await logAudit({
      userId: session.user.id,
      action: "attendance.check_in",
      entity: "attendance",
      entityId: row.id,
      after: { date: row.date.toISOString().slice(0, 10), status: row.status },
    });
    return NextResponse.json(serializeAttendance(row), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
