import { NextResponse } from "next/server";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { checkIn } from "@/lib/attendance";
import { serializeAttendance } from "@/lib/attendance-constants";
import { prisma } from "@/lib/db";
import { dealUnassignedWebsiteOrders } from "@/lib/website-assignment";

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
    // ROUND3 W-6 — an SE is in: website orders nobody could be given go out
    // now. Never fails the check-in.
    await dealUnassignedWebsiteOrders(prisma).catch((e) => console.error("Dealing website orders failed:", e));
    return NextResponse.json(serializeAttendance(row), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
