import { NextResponse } from "next/server";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { updateShift, deleteShift } from "@/lib/attendance";

type Params = { params: Promise<{ id: string }> };

// R10 — edit a shift (times/thresholds/active flag). Admin-only.
export async function PUT(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("settings.manage");
    const id = Number((await params).id);
    if (!Number.isInteger(id)) throw new AuthzError(400, "Invalid shift id");
    const { before, after } = await updateShift(id, await req.json(), session.user.id);
    await logAudit({
      userId: session.user.id,
      action: "shift.update",
      entity: "shifts",
      entityId: id,
      before,
      after,
    });
    return NextResponse.json(after);
  } catch (e) {
    return apiError(e);
  }
}

// Delete an unused shift; one referenced by roster history is blocked (400) —
// deactivate it instead so past evaluations keep resolving.
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const session = await requirePermission("settings.manage");
    const id = Number((await params).id);
    if (!Number.isInteger(id)) throw new AuthzError(400, "Invalid shift id");
    const before = await deleteShift(id);
    await logAudit({
      userId: session.user.id,
      action: "shift.delete",
      entity: "shifts",
      entityId: id,
      before,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
