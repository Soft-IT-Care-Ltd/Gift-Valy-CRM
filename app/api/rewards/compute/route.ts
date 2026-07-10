import { NextResponse } from "next/server";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { computeRewardsForMonth, monthSchema } from "@/lib/targets";

// SPEC §10 — month-close: compute who qualified against their targets and the
// active reward rules, and record the results as PENDING rewards awaiting Admin
// approval. Idempotent — safe to re-run as more orders land for the month.
export async function POST(req: Request) {
  try {
    const session = await requirePermission("targets.manage");
    const { monthKey } = monthSchema.parse(await req.json());
    const result = await computeRewardsForMonth(monthKey, session.user.id);

    await logAudit({
      userId: session.user.id,
      action: "rewards.compute",
      entity: "rewards",
      entityId: monthKey,
      after: result,
    });
    return NextResponse.json(result);
  } catch (e) {
    return apiError(e);
  }
}
