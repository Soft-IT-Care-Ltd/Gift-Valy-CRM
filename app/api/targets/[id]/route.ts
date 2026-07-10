import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

// SPEC §10 — remove a target (a mistake or a subject that no longer applies).
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const session = await requirePermission("targets.manage");
    const id = Number((await params).id);
    if (!Number.isInteger(id)) throw new AuthzError(400, "Invalid target id");

    const target = await prisma.target.findUnique({ where: { id } });
    if (!target) throw new AuthzError(404, "Target not found");

    await prisma.target.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: "target.delete",
      entity: "targets",
      entityId: id,
      before: {
        month: target.month.toISOString().slice(0, 7),
        scope: target.scope,
        userId: target.userId,
        teamId: target.teamId,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
