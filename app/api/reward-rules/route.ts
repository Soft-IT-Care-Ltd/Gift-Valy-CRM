import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { rewardRuleSchema } from "@/lib/targets";

// SPEC §10 — create a reward rule (e.g. ≥100% → ৳3,000, ≥120% → ৳6,000, or a
// top-seller bonus). Rule name is unique.
export async function POST(req: Request) {
  try {
    const session = await requirePermission("targets.manage");
    const data = rewardRuleSchema.parse(await req.json());

    try {
      const rule = await prisma.rewardRule.create({
        data: {
          name: data.name,
          type: data.type,
          // Threshold only applies to achievement rules.
          minAchievementPercent:
            data.type === "ACHIEVEMENT" ? data.minAchievementPercent ?? null : null,
          rewardAmount: data.rewardAmount,
          isActive: data.isActive,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        },
        select: { id: true },
      });
      await logAudit({
        userId: session.user.id,
        action: "reward_rule.create",
        entity: "reward_rules",
        entityId: rule.id,
        after: data,
      });
      return NextResponse.json({ id: rule.id }, { status: 201 });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new AuthzError(400, "A reward rule with this name already exists");
      }
      throw e;
    }
  } catch (e) {
    return apiError(e);
  }
}
