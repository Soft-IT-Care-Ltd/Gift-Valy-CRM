import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermissionCtx, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { normalizePhone } from "@/lib/order-constants";
import {
  createLeadSchema,
  resolveInterested,
  validateLostReason,
} from "@/lib/leads";
import { Prisma, type LeadStatus, type LostReason } from "@prisma/client";

// SPEC §3.1 — quick lead entry (<30s). Assigned SE defaults to the creator;
// only leads.reassign may file a new lead under someone else.
export async function POST(req: Request) {
  try {
    const { session, permissions } = await requirePermissionCtx("leads.create");
    const data = createLeadSchema.parse(await req.json());

    const lostErr = validateLostReason(data.status, data.lostReason);
    if (lostErr) throw new AuthzError(400, lostErr);

    // Resolve the assignee (§3.1 "Assigned SE = logged-in SE; TL/Admin reassign").
    let assignedTo = session.user.id;
    if (data.assignedTo && data.assignedTo !== session.user.id) {
      if (!permissions.includes("leads.reassign")) {
        throw new AuthzError(403, "Not allowed to assign leads to another SE");
      }
      assignedTo = data.assignedTo;
    }
    const assignee = await prisma.user.findUnique({
      where: { id: assignedTo },
      select: { id: true, isActive: true, teamId: true },
    });
    if (!assignee || !assignee.isActive) {
      throw new AuthzError(400, "Assigned user not found");
    }

    const interestedIn = await resolveInterested(prisma, data.interestedIn);

    const lead = await prisma.lead.create({
      data: {
        leadDate: new Date(`${data.leadDate}T00:00:00+06:00`),
        source: data.source,
        campaignName: data.campaignName,
        customerName: data.customerName,
        country: data.country,
        whatsappNumber: normalizePhone(data.whatsappNumber),
        interestedIn: interestedIn as unknown as Prisma.InputJsonValue,
        status: data.status as LeadStatus,
        followUpAt: data.followUpAt ? new Date(data.followUpAt) : null,
        lostReason: (data.lostReason ?? null) as LostReason | null,
        notes: data.notes,
        assignedTo,
        teamId: assignee.teamId,
        createdBy: session.user.id,
        updatedBy: session.user.id,
      },
      select: { id: true },
    });

    await logAudit({
      userId: session.user.id,
      action: "lead.create",
      entity: "leads",
      entityId: lead.id,
      after: {
        source: data.source,
        status: data.status,
        assignedTo,
        whatsappNumber: normalizePhone(data.whatsappNumber),
      },
    });
    return NextResponse.json({ id: lead.id }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
