import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermissionCtx, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { leadScopeWhere, reassignLeadSchema } from "@/lib/leads";

type Params = { params: Promise<{ id: string }> };

// SPEC §3.2 — TL/Manager reassign a lead (e.g. when an SE is absent). The new
// assignee's team travels with the lead so team scope stays correct.
export async function POST(req: Request, { params }: Params) {
  try {
    const { session, permissions } = await requirePermissionCtx("leads.reassign");
    const id = Number((await params).id);
    if (!Number.isInteger(id)) throw new AuthzError(400, "Invalid lead id");
    const { assignedTo } = reassignLeadSchema.parse(await req.json());

    const scope = await leadScopeWhere(session, permissions);
    const lead = await prisma.lead.findFirst({
      where: { AND: [scope, { id }] },
      include: { assignee: { select: { name: true } } },
    });
    if (!lead) throw new AuthzError(404, "Lead not found");

    const assignee = await prisma.user.findUnique({
      where: { id: assignedTo },
      select: { id: true, name: true, isActive: true, teamId: true },
    });
    if (!assignee || !assignee.isActive) {
      throw new AuthzError(400, "Target user not found");
    }
    if (assignee.id === lead.assignedTo) {
      throw new AuthzError(400, "Lead is already assigned to that user");
    }

    await prisma.lead.update({
      where: { id },
      data: {
        assignedTo: assignee.id,
        teamId: assignee.teamId,
        updatedBy: session.user.id,
      },
    });

    await logAudit({
      userId: session.user.id,
      action: "lead.reassign",
      entity: "leads",
      entityId: id,
      before: { assignedTo: lead.assignedTo, assignee: lead.assignee.name },
      after: { assignedTo: assignee.id, assignee: assignee.name },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
