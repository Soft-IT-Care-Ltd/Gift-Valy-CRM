import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { decideLeaveRequest, cancelLeaveRequest } from "@/lib/attendance";

type Params = { params: Promise<{ id: string }> };

const actionSchema = z.object({ action: z.enum(["approve", "reject"]) });

// SPEC §11 — a manager (attendance.view_all) approves or rejects a pending
// leave request. Approved requests mark their span as LEAVE in the R10 sheet.
export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("attendance.view_all");
    const id = Number((await params).id);
    if (!Number.isInteger(id)) throw new AuthzError(400, "Invalid request id");
    const { action } = actionSchema.parse(await req.json());
    const approve = action === "approve";

    await decideLeaveRequest(id, approve, session.user.id, new Date());
    await logAudit({
      userId: session.user.id,
      action: approve ? "leave.approve" : "leave.reject",
      entity: "leave_requests",
      entityId: id,
      after: { status: approve ? "APPROVED" : "REJECTED" },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

// The requester withdraws their own still-pending request.
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const session = await requirePermission("attendance.own");
    const id = Number((await params).id);
    if (!Number.isInteger(id)) throw new AuthzError(400, "Invalid request id");

    await cancelLeaveRequest(id, session.user.id);
    await logAudit({
      userId: session.user.id,
      action: "leave.cancel",
      entity: "leave_requests",
      entityId: id,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
