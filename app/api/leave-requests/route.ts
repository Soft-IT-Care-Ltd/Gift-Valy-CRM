import { NextResponse } from "next/server";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { createLeaveRequest, leaveRequestSchema } from "@/lib/attendance";

// SPEC §11 — an employee submits a leave request (PENDING until a manager acts).
export async function POST(req: Request) {
  try {
    const session = await requirePermission("attendance.own");
    const data = leaveRequestSchema.parse(await req.json());
    const { id } = await createLeaveRequest(session.user.id, data);
    await logAudit({
      userId: session.user.id,
      action: "leave.request",
      entity: "leave_requests",
      entityId: id,
      after: data,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
