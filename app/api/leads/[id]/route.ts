import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermissionCtx, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { normalizePhone } from "@/lib/order-constants";
import { dbDate } from "@/lib/orders";
import {
  canEditLead,
  leadCoreSchema,
  leadScopeWhere,
  resolveInterested,
  validateLostReason,
} from "@/lib/leads";
import { Prisma, type LeadStatus, type LostReason } from "@prisma/client";

type Params = { params: Promise<{ id: string }> };

// SPEC §3 — edit a lead's status/follow-up/lost-reason/details. Editable by
// leads.edit holders (any lead they can see) or the lead's own assignee.
export async function PATCH(req: Request, { params }: Params) {
  try {
    const { session, permissions } = await requirePermissionCtx("leads.view_own");
    const id = Number((await params).id);
    if (!Number.isInteger(id)) throw new AuthzError(400, "Invalid lead id");
    const data = leadCoreSchema.parse(await req.json());

    const scope = await leadScopeWhere(session, permissions);
    const lead = await prisma.lead.findFirst({
      where: { AND: [scope, { id }] },
    });
    if (!lead) throw new AuthzError(404, "Lead not found");
    if (!canEditLead(lead, session, permissions)) {
      throw new AuthzError(403, "Not allowed to edit this lead");
    }
    // A converted lead is locked to its order (§3.2) — un-converting it by hand
    // would break the 1:1 order link; corrections belong on the order.
    if (lead.status === "CONVERTED") {
      throw new AuthzError(
        400,
        "This lead is converted and locked — edit the linked order instead"
      );
    }

    const lostErr = validateLostReason(data.status, data.lostReason);
    if (lostErr) throw new AuthzError(400, lostErr);

    const interestedIn = await resolveInterested(prisma, data.interestedIn);

    await prisma.lead.update({
      where: { id },
      data: {
        leadDate: dbDate(data.leadDate), // @db.Date — UTC-midnight, not a +06 instant
        source: data.source,
        campaignName: data.campaignName,
        customerName: data.customerName,
        country: data.country,
        whatsappNumber: normalizePhone(data.whatsappNumber),
        interestedIn: interestedIn as unknown as Prisma.InputJsonValue,
        status: data.status as LeadStatus,
        // CORRECTIONS Leads §9 — (re)entering COMMITTED restarts the
        // time-since-commitment clock; the stamp is kept otherwise.
        ...(data.status === "COMMITTED" && lead.status !== "COMMITTED"
          ? { committedAt: new Date() }
          : {}),
        followUpAt: data.followUpAt ? new Date(data.followUpAt) : null,
        // Clear the lost reason whenever the lead isn't LOST (§3.1).
        lostReason:
          data.status === "LOST"
            ? ((data.lostReason ?? null) as LostReason | null)
            : null,
        notes: data.notes,
        updatedBy: session.user.id,
      },
    });

    await logAudit({
      userId: session.user.id,
      action: "lead.update",
      entity: "leads",
      entityId: id,
      before: { status: lead.status, followUpAt: lead.followUpAt, lostReason: lead.lostReason },
      after: { status: data.status, followUpAt: data.followUpAt, lostReason: data.lostReason ?? null },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
