import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { approveReward, markRewardPaid, rejectReward } from "@/lib/targets";

type Params = { params: Promise<{ id: string }> };

const actionSchema = z.object({ action: z.enum(["approve", "paid"]) });

// SPEC §10 — Admin approval turns a computed reward into an expense record (and
// the SE's profile history); "paid" marks an approved reward disbursed.
export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("targets.manage");
    const id = Number((await params).id);
    if (!Number.isInteger(id)) throw new AuthzError(400, "Invalid reward id");
    const { action } = actionSchema.parse(await req.json());

    if (action === "approve") {
      const { expenseId } = await prisma.$transaction((tx) =>
        approveReward(id, session.user.id, new Date(), tx)
      );
      await logAudit({
        userId: session.user.id,
        action: "reward.approve",
        entity: "rewards",
        entityId: id,
        after: { status: "APPROVED", expenseId },
      });
      return NextResponse.json({ ok: true, expenseId });
    }

    await markRewardPaid(id, session.user.id);
    await logAudit({
      userId: session.user.id,
      action: "reward.paid",
      entity: "rewards",
      entityId: id,
      after: { status: "PAID" },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

// Reject = discard a pending computed reward (before approval).
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const session = await requirePermission("targets.manage");
    const id = Number((await params).id);
    if (!Number.isInteger(id)) throw new AuthzError(400, "Invalid reward id");

    await rejectReward(id);
    await logAudit({
      userId: session.user.id,
      action: "reward.reject",
      entity: "rewards",
      entityId: id,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
