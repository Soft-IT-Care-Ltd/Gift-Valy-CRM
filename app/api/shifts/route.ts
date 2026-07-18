import { NextResponse } from "next/server";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getShifts, createShift } from "@/lib/attendance";

// R10 — shift definitions. Admin-only (settings.manage), same gate as the
// office-hours settings they extend.
export async function GET() {
  try {
    await requirePermission("settings.manage");
    return NextResponse.json(await getShifts());
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requirePermission("settings.manage");
    const shift = await createShift(await req.json(), session.user.id);
    await logAudit({
      userId: session.user.id,
      action: "shift.create",
      entity: "shifts",
      entityId: shift.id,
      after: shift,
    });
    return NextResponse.json(shift, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
