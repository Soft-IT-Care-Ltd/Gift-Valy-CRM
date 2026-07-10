import { NextResponse } from "next/server";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { targetUpsertSchema, upsertTarget } from "@/lib/targets";

// SPEC §10 — set a monthly target for an SE/TL (USER) or a Team. Upsert: one
// target per subject per month, so re-saving edits the existing row.
export async function POST(req: Request) {
  try {
    const session = await requirePermission("targets.manage");
    const data = targetUpsertSchema.parse(await req.json());
    const { id, created } = await upsertTarget(data, session.user.id);

    await logAudit({
      userId: session.user.id,
      action: created ? "target.create" : "target.update",
      entity: "targets",
      entityId: id,
      after: {
        month: data.monthKey,
        scope: data.scope,
        userId: data.userId ?? null,
        teamId: data.teamId ?? null,
        targetOrders: data.targetOrders,
        targetAmount: data.targetAmount,
        isConfidential: data.isConfidential,
      },
    });
    return NextResponse.json({ id }, { status: created ? 201 : 200 });
  } catch (e) {
    return apiError(e);
  }
}
