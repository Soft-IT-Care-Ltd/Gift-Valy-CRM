import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { rewardRuleSchema } from "@/lib/targets";

type Params = { params: Promise<{ id: string }> };

// SPEC §10 — edit a reward rule (threshold, amount, name, active flag).
export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("targets.manage");
    const id = Number((await params).id);
    if (!Number.isInteger(id)) throw new AuthzError(400, "Invalid rule id");
    const data = rewardRuleSchema.parse(await req.json());

    const existing = await prisma.rewardRule.findUnique({ where: { id } });
    if (!existing) throw new AuthzError(404, "Reward rule not found");

    try {
      await prisma.rewardRule.update({
        where: { id },
        data: {
          name: data.name,
          type: data.type,
          minAchievementPercent:
            data.type === "ACHIEVEMENT" ? data.minAchievementPercent ?? null : null,
          rewardAmount: data.rewardAmount,
          isActive: data.isActive,
          updatedBy: session.user.id,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new AuthzError(400, "A reward rule with this name already exists");
      }
      throw e;
    }

    await logAudit({
      userId: session.user.id,
      action: "reward_rule.update",
      entity: "reward_rules",
      entityId: id,
      after: data,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

// Hard-delete only when the rule has never paid out; otherwise deactivate so the
// reward history keeps its rule reference intact.
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const session = await requirePermission("targets.manage");
    const id = Number((await params).id);
    if (!Number.isInteger(id)) throw new AuthzError(400, "Invalid rule id");

    const rule = await prisma.rewardRule.findUnique({
      where: { id },
      include: { _count: { select: { rewards: true } } },
    });
    if (!rule) throw new AuthzError(404, "Reward rule not found");

    if (rule._count.rewards > 0) {
      throw new AuthzError(
        400,
        "This rule has rewards on record — deactivate it instead of deleting"
      );
    }
    await prisma.rewardRule.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: "reward_rule.delete",
      entity: "reward_rules",
      entityId: id,
      before: { name: rule.name },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
