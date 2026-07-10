import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getOnboardingExcludeDays } from "@/lib/settings";
import { monthKeyOf, MONTH_KEY_RE } from "@/lib/targets-constants";
import { monthDateKey } from "@/lib/targets";
import {
  serializeTarget,
  serializeRewardRule,
  serializeReward,
  TARGET_INCLUDE,
  REWARD_INCLUDE,
} from "@/lib/targets-constants";
import { TargetsManageClient } from "@/components/targets/manage-client";

export const dynamic = "force-dynamic";

// SPEC §10 admin — set targets, maintain reward rules, run month-close reward
// computation and approve payouts. Gated on targets.manage (Admin, Manager).
export default async function TargetsManagePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requirePagePermission("targets.manage");
  const sp = await searchParams;
  const monthKey =
    sp.month && MONTH_KEY_RE.test(sp.month) ? sp.month : monthKeyOf(new Date());
  const month = monthDateKey(monthKey);

  const [users, teams, targets, rules, rewards, onboardingExcludeDays] =
    await Promise.all([
      prisma.user.findMany({
        where: {
          isActive: true,
          role: { name: { in: ["SalesExecutive", "TeamLeader", "Manager"] } },
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          isOnboarding: true,
          role: { select: { name: true } },
          team: { select: { name: true } },
        },
      }),
      prisma.team.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.target.findMany({
        where: { month },
        include: TARGET_INCLUDE,
        orderBy: [{ scope: "asc" }, { id: "asc" }],
      }),
      prisma.rewardRule.findMany({ orderBy: [{ isActive: "desc" }, { id: "asc" }] }),
      prisma.reward.findMany({
        where: { month },
        include: REWARD_INCLUDE,
        orderBy: [{ status: "asc" }, { amount: "desc" }],
      }),
      getOnboardingExcludeDays(),
    ]);

  return (
    <TargetsManageClient
      monthKey={monthKey}
      users={users.map((u) => ({
        id: u.id,
        name: u.name,
        roleName: u.role.name,
        teamName: u.team?.name ?? null,
        isOnboarding: u.isOnboarding,
      }))}
      teams={teams}
      targets={targets.map(serializeTarget)}
      rules={rules.map(serializeRewardRule)}
      rewards={rewards.map(serializeReward)}
      onboardingExcludeDays={onboardingExcludeDays}
    />
  );
}
