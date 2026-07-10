// Targets & Rewards verification (SPEC §10). Drives gauge math, month windows,
// onboarding exclusion, target upsert, achievement aggregation, the leaderboard,
// reward computation (achievement tiers + top seller), idempotent recompute,
// approval → expense booking, rejection, and confidential-target visibility —
// all inside ONE rolled-back transaction (mirrors verify-leads).
import { PrismaClient, Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import {
  assembleGauge,
  monthKeyOf,
} from "../lib/targets-constants";
import {
  monthWindow,
  monthDateKey,
  isOnboardingExcluded,
  upsertTarget,
  aggregateUserAchievement,
  aggregateTeamAchievement,
  buildLeaderboard,
  computeRewardCandidates,
  computeRewardsForMonth,
  approveReward,
  rejectReward,
  markRewardPaid,
  visibleGauges,
} from "../lib/targets";

const prisma = new PrismaClient();
const ROLLBACK = "ROLLBACK_SENTINEL";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label} ${detail}`);
  }
}

const DAY_MS = 86_400_000;

async function main() {
  console.log("Targets & Rewards verification — SPEC §10\n");

  // ---------- pure gauge math (no DB) ----------
  console.log("Gauge math (§10):");
  const now = new Date("2026-07-10T12:00:00+06:00");
  const g = assembleGauge({
    scope: "USER",
    subjectId: 1,
    subjectName: "Test",
    isConfidential: false,
    targetId: 1,
    targetOrders: 100,
    targetAmount: 500000,
    achievedOrders: 22,
    achievedAmount: 250000,
    monthKey: "2026-07",
    now,
  });
  check("days in month = 31", g.daysInMonth === 31, `got ${g.daysInMonth}`);
  check("day of month = 10", g.dayOfMonth === 10, `got ${g.dayOfMonth}`);
  check("days left counts today (22)", g.daysLeft === 22, `got ${g.daysLeft}`);
  check("orders % = 22", g.ordersPct === 22, `got ${g.ordersPct}`);
  check("amount % = 50", g.amountPct === 50, `got ${g.amountPct}`);
  check("primary % uses sales value (50)", g.primaryPct === 50, `got ${g.primaryPct}`);
  check(
    "required daily orders = (100-22)/22 = 3.55",
    g.requiredDailyOrders === 3.55,
    `got ${g.requiredDailyOrders}`
  );
  check("current month flagged", g.isCurrentMonth && !g.isPastMonth);

  const past = assembleGauge({
    scope: "USER", subjectId: 1, subjectName: "T", isConfidential: false,
    targetId: 1, targetOrders: 10, targetAmount: null,
    achievedOrders: 10, achievedAmount: 0, monthKey: "2026-06", now,
  });
  check("past month: 0 days left, no run-rate", past.isPastMonth && past.daysLeft === 0 && past.requiredDailyOrders === null);
  check("met target: 100% and run-rate 0", past.ordersPct === 100 && past.requiredDailyOrders === null);

  // ---------- month window / key ----------
  console.log("\nMonth window (§10):");
  const win = monthWindow("2026-07");
  check("window start = Jul 1 00:00 +06", win.start.toISOString() === "2026-06-30T18:00:00.000Z", win.start.toISOString());
  check("window end = Aug 1 00:00 +06", win.end.toISOString() === "2026-07-31T18:00:00.000Z", win.end.toISOString());
  check("month date key round-trips", monthDateKey("2026-07").toISOString().slice(0, 7) === "2026-07");

  // ---------- onboarding exclusion (§10) ----------
  console.log("\nOnboarding exclusion (§10):");
  const ref = new Date("2026-07-10T00:00:00Z");
  check("not onboarding → included", !isOnboardingExcluded({ isOnboarding: false, joinedAt: new Date(ref.getTime() - 100 * DAY_MS) }, ref, 30));
  check("onboarding + joined 5d ago → excluded", isOnboardingExcluded({ isOnboarding: true, joinedAt: new Date(ref.getTime() - 5 * DAY_MS) }, ref, 30));
  check("onboarding + joined 40d ago → included", !isOnboardingExcluded({ isOnboarding: true, joinedAt: new Date(ref.getTime() - 40 * DAY_MS) }, ref, 30));
  check("onboarding + no joinedAt → excluded", isOnboardingExcluded({ isOnboarding: true, joinedAt: null }, ref, 30));

  const monthKey = monthKeyOf(new Date());
  const seRole = await prisma.role.findUniqueOrThrow({ where: { name: "SalesExecutive" }, select: { id: true } });
  const tlRole = await prisma.role.findUniqueOrThrow({ where: { name: "TeamLeader" }, select: { id: true } });
  const customer = await prisma.customer.findFirstOrThrow({ select: { id: true } });

  try {
    await prisma.$transaction(async (tx) => {
      // ---- fresh, isolated test users + team so counts are controlled ----
      const team = await tx.team.create({ data: { name: "Verify Team T" } });
      let orderSeq = 0;
      const mkUser = (email: string, name: string, roleId: number, teamId: number) =>
        tx.user.create({
          data: { email, name, passwordHash: "x", roleId, teamId, isActive: true, joinedAt: new Date() },
          select: { id: true, name: true },
        });

      const U = await mkUser("verify-u@giftvaly.com", "Verify U (TL)", tlRole.id, team.id);
      const V = await mkUser("verify-v@giftvaly.com", "Verify V", seRole.id, team.id);
      const W = await mkUser("verify-w@giftvaly.com", "Verify W", seRole.id, team.id);
      await tx.team.update({ where: { id: team.id }, data: { leaderUserId: U.id } });
      // An onboarding member joined today — excluded from team aggregate.
      const Z = await tx.user.create({
        data: { email: "verify-z@giftvaly.com", name: "Verify Z (onboarding)", passwordHash: "x", roleId: seRole.id, teamId: team.id, isActive: true, isOnboarding: true, joinedAt: new Date() },
        select: { id: true, name: true },
      });

      const addOrder = (seId: number, amount: number, status: Prisma.OrderCreateInput["status"]) =>
        tx.order.create({
          data: {
            orderNo: `GV-VT-${String(++orderSeq).padStart(4, "0")}`,
            customerId: customer.id,
            recipientName: "R", recipientPhoneBd: "01700000000",
            deliveryAddress: "A", district: "Dhaka", thana: "Gulshan",
            subtotal: amount, totalAmount: amount, dueAmount: amount,
            status, salesExecutiveId: seId, teamId: team.id,
          },
          select: { id: true },
        });

      // ---- target upsert idempotency (§10) ----
      const created = await upsertTarget(
        { monthKey, scope: "USER", userId: V.id, teamId: null, targetOrders: null, targetAmount: 1000, isConfidential: false },
        U.id, tx
      );
      const updated = await upsertTarget(
        { monthKey, scope: "USER", userId: V.id, teamId: null, targetOrders: 5, targetAmount: 1000, isConfidential: false },
        U.id, tx
      );
      console.log("\nTarget upsert (§10):");
      check("first save creates", created.created === true);
      check("second save updates same row", updated.created === false && updated.id === created.id);
      const vTargetCount = await tx.target.count({ where: { month: monthDateKey(monthKey), userId: V.id } });
      check("one target per user per month", vTargetCount === 1, `got ${vTargetCount}`);

      // Confidential target for W; normal team target.
      await upsertTarget({ monthKey, scope: "USER", userId: W.id, teamId: null, targetOrders: null, targetAmount: 1000, isConfidential: true }, U.id, tx);
      await upsertTarget({ monthKey, scope: "TEAM", userId: null, teamId: team.id, targetOrders: null, targetAmount: 5000, isConfidential: false }, U.id, tx);

      // ---- achievement aggregation (§4.2 sale statuses) ----
      await addOrder(V.id, 700, "CONFIRMED");
      await addOrder(V.id, 500, "DELIVERED"); // V = 1200 across 2 orders → 120%
      await addOrder(V.id, 9999, "CANCELLED"); // excluded
      await addOrder(W.id, 1000, "CONFIRMED"); // W = 1000 → 100%
      await addOrder(Z.id, 4000, "CONFIRMED"); // onboarding — excluded from team

      const vAch = await aggregateUserAchievement(V.id, monthKey, tx);
      console.log("\nAchievement aggregation (§10):");
      check("V orders = 2 (cancelled excluded)", vAch.orders === 2, `got ${vAch.orders}`);
      check("V amount = 1200", vAch.amount === 1200, `got ${vAch.amount}`);

      const teamAll = await aggregateTeamAchievement(team.id, monthKey, [], tx);
      const teamExZ = await aggregateTeamAchievement(team.id, monthKey, [Z.id], tx);
      check("team incl onboarding = 1200+1000+4000 = 6200", teamAll.amount === 6200, `got ${teamAll.amount}`);
      check("team excl onboarding Z = 2200", teamExZ.amount === 2200, `got ${teamExZ.amount}`);

      // ---- leaderboard (§10) ----
      const board = await buildLeaderboard(monthKey, tx);
      const vRow = board.find((r) => r.userId === V.id);
      const wRow = board.find((r) => r.userId === W.id);
      console.log("\nLeaderboard (§10):");
      check("V on leaderboard with 1200", vRow?.amount === 1200, `got ${vRow?.amount}`);
      check("V ranks ahead of W by value", (vRow?.amountRank ?? 9) < (wRow?.amountRank ?? 0), `V=${vRow?.amountRank} W=${wRow?.amountRank}`);

      // ---- reward computation: tiers + highest wins (§10) ----
      // Ensure the three seeded rules exist within the tx view.
      const r100 = await tx.rewardRule.upsert({ where: { name: "VT 100%" }, update: { minAchievementPercent: 100, rewardAmount: 3000, isActive: true, type: "ACHIEVEMENT" }, create: { name: "VT 100%", type: "ACHIEVEMENT", minAchievementPercent: 100, rewardAmount: 3000 } });
      const r120 = await tx.rewardRule.upsert({ where: { name: "VT 120%" }, update: { minAchievementPercent: 120, rewardAmount: 6000, isActive: true, type: "ACHIEVEMENT" }, create: { name: "VT 120%", type: "ACHIEVEMENT", minAchievementPercent: 120, rewardAmount: 6000 } });
      // Deactivate any other active rules so this scenario is deterministic.
      await tx.rewardRule.updateMany({ where: { id: { notIn: [r100.id, r120.id] } }, data: { isActive: false } });

      const candidates = await computeRewardCandidates(monthKey, tx);
      const vCand = candidates.filter((c) => c.userId === V.id);
      const wCand = candidates.filter((c) => c.userId === W.id);
      console.log("\nReward computation (§10):");
      check("V (120%) gets the single highest tier = ৳6000", vCand.length === 1 && vCand[0].ruleId === r120.id && vCand[0].amount === 6000, JSON.stringify(vCand));
      check("V achievement % recorded = 120", vCand[0]?.achievementPercent === 120, `got ${vCand[0]?.achievementPercent}`);
      check("W (100%) gets ৳3000", wCand.length === 1 && wCand[0].ruleId === r100.id && wCand[0].amount === 3000, JSON.stringify(wCand));
      check("confidential target still earns rewards (W included)", wCand.length === 1);

      // Top-seller rule on top (stacks).
      const rTop = await tx.rewardRule.create({ data: { name: "VT Top", type: "TOP_SELLER", rewardAmount: 5000 } });
      const withTop = await computeRewardCandidates(monthKey, tx);
      const topWinners = withTop.filter((c) => c.ruleId === rTop.id);
      check("top-seller rule yields exactly one #1 winner", topWinners.length === 1, `got ${topWinners.length}`);
      await tx.rewardRule.update({ where: { id: rTop.id }, data: { isActive: false } }); // back to deterministic 2-rule set

      // ---- persist + idempotent recompute (§10) ----
      const first = await computeRewardsForMonth(monthKey, U.id, tx);
      const again = await computeRewardsForMonth(monthKey, U.id, tx);
      const vRewards = await tx.reward.count({ where: { month: monthDateKey(monthKey), userId: V.id } });
      console.log("\nPersist + recompute (§10):");
      check("first compute created rewards", first.created > 0, `created ${first.created}`);
      check("recompute creates no duplicates", again.created === 0, `created ${again.created}`);
      check("V has exactly one reward row", vRewards === 1, `got ${vRewards}`);

      // ---- approval → expense (§10) ----
      const vReward = await tx.reward.findFirstOrThrow({ where: { month: monthDateKey(monthKey), userId: V.id } });
      const approvalNow = new Date();
      const expectedDhakaDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(approvalNow);
      const { expenseId } = await approveReward(vReward.id, U.id, approvalNow, tx);
      const expense = await tx.expense.findUniqueOrThrow({ where: { id: expenseId }, include: { category: true } });
      const approved = await tx.reward.findUniqueOrThrow({ where: { id: vReward.id } });
      console.log("\nApproval → expense (§10):");
      check("reward flipped to APPROVED", approved.status === "APPROVED");
      check("expense linked back to reward", approved.expenseId === expenseId);
      check("expense category = Reward/Bonus", expense.category.name === "Reward/Bonus", expense.category.name);
      check("expense amount = reward amount", Number(expense.amount) === 6000, `got ${expense.amount}`);
      check("expense ref → rewards row", expense.refTable === "rewards" && expense.refId === vReward.id);
      check(
        "expense date = Dhaka approval day (no @db.Date off-by-one)",
        expense.expenseDate.toISOString().slice(0, 10) === expectedDhakaDay,
        `stored ${expense.expenseDate.toISOString().slice(0, 10)} want ${expectedDhakaDay}`
      );

      let doubleApprove = false;
      try { await approveReward(vReward.id, U.id, new Date(), tx); } catch { doubleApprove = true; }
      check("cannot approve twice", doubleApprove);

      // mark paid.
      await markRewardPaid(vReward.id, U.id, tx);
      const paid = await tx.reward.findUniqueOrThrow({ where: { id: vReward.id } });
      check("approved → paid", paid.status === "PAID");

      // ---- reject a pending reward (§10) ----
      const wReward = await tx.reward.findFirstOrThrow({ where: { month: monthDateKey(monthKey), userId: W.id } });
      await rejectReward(wReward.id, tx);
      const wGone = await tx.reward.findUnique({ where: { id: wReward.id } });
      console.log("\nRejection (§10):");
      check("pending reward rejected (deleted)", wGone === null);
      let rejectApproved = false;
      try { await rejectReward(vReward.id, tx); } catch { rejectApproved = true; }
      check("cannot reject an approved/paid reward", rejectApproved);

      // ---- confidential visibility (§10) ----
      const sess = (id: number, role: string, name: string): Session =>
        ({ user: { id, role, name } }) as unknown as Session;
      console.log("\nConfidential visibility (§10):");

      // V's target is non-confidential; W's is confidential (set above).
      const asTL = await visibleGauges(sess(U.id, "TeamLeader", "Verify U"), ["targets.view_own", "targets.view_team"], monthKey, new Date(), tx);
      const tlMemberIds = asTL.members.map((m) => m.subjectId);
      check("TL sees V (non-confidential teammate)", tlMemberIds.includes(V.id), JSON.stringify(tlMemberIds));
      check("TL cannot see W's confidential target", !tlMemberIds.includes(W.id));
      check("TL sees the team gauge", asTL.teams.some((t) => t.subjectId === team.id));

      const asAdmin = await visibleGauges(sess(U.id + 100000, "Admin", "Owner"), ["targets.manage"], monthKey, new Date(), tx);
      const adminMemberIds = asAdmin.members.map((m) => m.subjectId);
      check("Admin sees confidential target W", adminMemberIds.includes(W.id), JSON.stringify(adminMemberIds));

      const asPeer = await visibleGauges(sess(V.id, "SalesExecutive", "Verify V"), ["targets.view_own"], monthKey, new Date(), tx);
      check("peer SE (own only) sees own gauge", asPeer.own?.subjectId === V.id);
      check("peer SE sees no other members", asPeer.members.length === 0, `got ${asPeer.members.length}`);

      throw new Error(ROLLBACK);
    }, { timeout: 60000 });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
