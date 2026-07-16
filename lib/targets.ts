import type { OrderStatus, Prisma, PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { z } from "zod";
import { prisma } from "./db";
import { AuthzError } from "./authz";
import { EXCLUDED_SALE_STATUSES } from "./order-constants";
import { getOnboardingExcludeDays } from "./settings";
import {
  assembleGauge,
  monthKeyOf,
  pctOf,
  REWARD_EXPENSE_CATEGORY,
  REWARD_INCLUDE,
  MONTH_KEY_RE,
  TARGET_SCOPES,
  REWARD_RULE_TYPES,
  type Gauge,
  type LeaderboardRow,
} from "./targets-constants";

type Tx = Prisma.TransactionClient | PrismaClient;

const DAY_MS = 24 * 60 * 60 * 1000;
// Orders count toward achievement unless their money came back (§4.2). Cast once.
const SALE_STATUS_FILTER = {
  notIn: EXCLUDED_SALE_STATUSES as unknown as OrderStatus[],
};

// ---------- month → Date key / instant window ----------

// The @db.Date value stored in Target.month / Reward.month for a month: UTC
// midnight of the 1st. A pure calendar key (no timezone tricks) so a write and a
// later equality lookup always round-trip to the same stored date.
export function monthDateKey(monthKey: string): Date {
  return new Date(`${monthKey}-01T00:00:00.000Z`);
}

// The [start, end) instants (Asia/Dhaka) bounding a month, for filtering
// order.created_at (a real timestamp) — this is what makes achievement align
// with the office calendar regardless of how the DATE key is stored.
export function monthWindow(monthKey: string): { start: Date; end: Date } {
  const [y, m] = monthKey.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const start = new Date(`${monthKey}-01T00:00:00.000+06:00`);
  const end = new Date(
    `${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00.000+06:00`
  );
  return { start, end };
}

// ---------- achievement aggregation ----------

export interface Achievement {
  orders: number;
  amount: number;
}

export async function aggregateUserAchievement(
  userId: number,
  monthKey: string,
  db: Tx = prisma
): Promise<Achievement> {
  const { start, end } = monthWindow(monthKey);
  const agg = await db.order.aggregate({
    where: {
      salesExecutiveId: userId,
      status: SALE_STATUS_FILTER,
      createdAt: { gte: start, lt: end },
    },
    _count: { _all: true },
    _sum: { totalAmount: true },
  });
  return { orders: agg._count._all, amount: Number(agg._sum.totalAmount ?? 0) };
}

export async function aggregateTeamAchievement(
  teamId: number,
  monthKey: string,
  excludeUserIds: number[],
  db: Tx = prisma
): Promise<Achievement> {
  const { start, end } = monthWindow(monthKey);
  const agg = await db.order.aggregate({
    where: {
      teamId,
      status: SALE_STATUS_FILTER,
      createdAt: { gte: start, lt: end },
      ...(excludeUserIds.length
        ? { salesExecutiveId: { notIn: excludeUserIds } }
        : {}),
    },
    _count: { _all: true },
    _sum: { totalAmount: true },
  });
  return { orders: agg._count._all, amount: Number(agg._sum.totalAmount ?? 0) };
}

// SPEC §10 — a member counts toward team aggregates unless they are flagged
// onboarding AND still inside the first N days after joining. No joinedAt on an
// onboarding flag → treat as still in grace (excluded).
export function isOnboardingExcluded(
  user: { isOnboarding: boolean; joinedAt: Date | null },
  now: Date,
  days: number
): boolean {
  if (!user.isOnboarding) return false;
  if (!user.joinedAt) return true;
  return now.getTime() - user.joinedAt.getTime() < days * DAY_MS;
}

// ---------- gauge builders (SPEC §10 live progress) ----------

async function findTarget(
  where: Prisma.TargetWhereInput,
  db: Tx
): Promise<{
  id: number;
  targetOrders: number | null;
  targetAmount: number | null;
  isConfidential: boolean;
} | null> {
  const t = await db.target.findFirst({ where });
  if (!t) return null;
  return {
    id: t.id,
    targetOrders: t.targetOrders,
    targetAmount: t.targetAmount != null ? Number(t.targetAmount) : null,
    isConfidential: t.isConfidential,
  };
}

export async function buildUserGauge(
  user: { id: number; name: string },
  monthKey: string,
  now: Date,
  db: Tx = prisma
): Promise<Gauge> {
  const [target, achievement] = await Promise.all([
    findTarget(
      { scope: "USER", userId: user.id, month: monthDateKey(monthKey) },
      db
    ),
    aggregateUserAchievement(user.id, monthKey, db),
  ]);
  return assembleGauge({
    scope: "USER",
    subjectId: user.id,
    subjectName: user.name,
    isConfidential: target?.isConfidential ?? false,
    targetId: target?.id ?? null,
    targetOrders: target?.targetOrders ?? null,
    targetAmount: target?.targetAmount ?? null,
    achievedOrders: achievement.orders,
    achievedAmount: achievement.amount,
    monthKey,
    now,
  });
}

export async function buildTeamGauge(
  team: { id: number; name: string },
  monthKey: string,
  now: Date,
  db: Tx = prisma
): Promise<Gauge> {
  const days = await getOnboardingExcludeDays();
  const members = await db.user.findMany({
    where: { teamId: team.id },
    select: { id: true, isOnboarding: true, joinedAt: true },
  });
  const excluded = members
    .filter((m) => isOnboardingExcluded(m, now, days))
    .map((m) => m.id);

  const [target, achievement] = await Promise.all([
    findTarget(
      { scope: "TEAM", teamId: team.id, month: monthDateKey(monthKey) },
      db
    ),
    aggregateTeamAchievement(team.id, monthKey, excluded, db),
  ]);
  return assembleGauge({
    scope: "TEAM",
    subjectId: team.id,
    subjectName: team.name,
    isConfidential: target?.isConfidential ?? false,
    targetId: target?.id ?? null,
    targetOrders: target?.targetOrders ?? null,
    targetAmount: target?.targetAmount ?? null,
    achievedOrders: achievement.orders,
    achievedAmount: achievement.amount,
    monthKey,
    now,
    onboardingExcludedCount: excluded.length,
  });
}

// ---------- leaderboard (SPEC §10 — visible to all, values only) ----------

// The sellers ranked: active Sales Executives and Team Leaders, by this month's
// sales value and by order count. No costs, no reward amounts — pure motivation.
export async function buildLeaderboard(
  monthKey: string,
  db: Tx = prisma
): Promise<LeaderboardRow[]> {
  const { start, end } = monthWindow(monthKey);
  const sellers = await db.user.findMany({
    where: {
      isActive: true,
      role: { name: { in: ["SalesExecutive", "TeamLeader"] } },
    },
    select: {
      id: true,
      name: true,
      isOnboarding: true,
      team: { select: { name: true } },
    },
  });
  const grouped = await db.order.groupBy({
    by: ["salesExecutiveId"],
    where: { status: SALE_STATUS_FILTER, createdAt: { gte: start, lt: end } },
    _count: { _all: true },
    _sum: { totalAmount: true },
  });
  const byUser = new Map(
    grouped.map((g) => [
      g.salesExecutiveId,
      { orders: g._count._all, amount: Number(g._sum.totalAmount ?? 0) },
    ])
  );

  const rows = sellers.map((s) => {
    const stat = byUser.get(s.id) ?? { orders: 0, amount: 0 };
    return {
      userId: s.id,
      name: s.name,
      teamName: s.team?.name ?? null,
      isOnboarding: s.isOnboarding,
      orders: stat.orders,
      amount: stat.amount,
      amountRank: 0,
      ordersRank: 0,
    };
  });

  // Standard competition ranking (ties share a rank) for each metric.
  rankBy(rows, (r) => r.amount, (r, rank) => (r.amountRank = rank));
  rankBy(rows, (r) => r.orders, (r, rank) => (r.ordersRank = rank));
  // Default order: best sales value first.
  rows.sort((a, b) => a.amountRank - b.amountRank || b.orders - a.orders);
  return rows;
}

function rankBy(
  rows: LeaderboardRow[],
  value: (r: LeaderboardRow) => number,
  set: (r: LeaderboardRow, rank: number) => void
): void {
  const sorted = [...rows].sort((a, b) => value(b) - value(a));
  let prev: number | null = null;
  let rank = 0;
  sorted.forEach((r, i) => {
    const v = value(r);
    if (prev === null || v !== prev) rank = i + 1;
    set(r, rank);
    prev = v;
  });
}

// ---------- gauge visibility / scoping (SPEC §2.2 / §10) ----------

export interface VisibleGauges {
  own: Gauge | null;
  teams: Gauge[];
  members: Gauge[];
}

// Resolve the gauges a viewer may see this month:
//  • own      — their personal gauge (any targets.view_own), even with no target
//  • members  — other users' gauges, respecting confidentiality (§10)
//  • teams    — team gauges within scope
// Confidential targets are visible only to the subject and to an Admin (§10).
export async function visibleGauges(
  session: Session,
  permissions: string[],
  monthKey: string,
  now: Date,
  db: Tx = prisma
): Promise<VisibleGauges> {
  const isAdmin = session.user.role === "Admin";
  const canManage = permissions.includes("targets.manage");
  const canTeam = permissions.includes("targets.view_team");
  const canOwn = permissions.includes("targets.view_own");

  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, teamId: true, leaderOf: { select: { id: true } } },
  });
  const myTeamIds = new Set<number>([
    ...(me?.teamId ? [me.teamId] : []),
    ...(me?.leaderOf.map((t) => t.id) ?? []),
  ]);

  const own =
    canOwn && me
      ? await buildUserGauge(
          { id: me.id, name: session.user.name ?? "You" },
          monthKey,
          now,
          db
        )
      : null;

  // All targets set this month; decide per-row who may see the resulting gauge.
  const targets = await db.target.findMany({
    where: { month: monthDateKey(monthKey) },
    include: {
      user: { select: { id: true, name: true, teamId: true } },
      team: { select: { id: true, name: true } },
    },
  });

  const members: Gauge[] = [];
  const teams: Gauge[] = [];
  for (const t of targets) {
    if (t.scope === "USER" && t.user) {
      if (t.user.id === session.user.id) continue; // covered by `own`
      const inMyTeam = t.user.teamId != null && myTeamIds.has(t.user.teamId);
      const visible = t.isConfidential
        ? isAdmin
        : canManage || (canTeam && inMyTeam);
      if (!visible) continue;
      members.push(
        await buildUserGauge(
          { id: t.user.id, name: t.user.name },
          monthKey,
          now,
          db
        )
      );
    } else if (t.scope === "TEAM" && t.team) {
      const visible = canManage || (canTeam && myTeamIds.has(t.team.id));
      if (!visible) continue;
      teams.push(await buildTeamGauge(t.team, monthKey, now, db));
    }
  }
  return { own, teams, members };
}

// ---------- payload validation ----------

const nullableNonNegInt = z
  .number()
  .int()
  .min(0)
  .nullable()
  .optional()
  .transform((v) => (v == null ? null : v));

const nullableNonNegNum = z
  .number()
  .min(0)
  .nullable()
  .optional()
  .transform((v) => (v == null ? null : v));

export const targetUpsertSchema = z
  .object({
    monthKey: z.string().regex(MONTH_KEY_RE, "Pick a month (YYYY-MM)"),
    scope: z.enum(TARGET_SCOPES),
    userId: z.number().int().positive().nullable().optional(),
    teamId: z.number().int().positive().nullable().optional(),
    targetOrders: nullableNonNegInt,
    targetAmount: nullableNonNegNum,
    isConfidential: z.boolean().optional().default(false),
  })
  .refine((d) => (d.scope === "USER" ? !!d.userId : !!d.teamId), {
    message: "Pick who the target is for",
  })
  .refine(
    (d) => (d.targetOrders ?? 0) > 0 || (d.targetAmount ?? 0) > 0,
    { message: "Set an order-count and/or a sales-value target" }
  );

export type TargetUpsertPayload = z.infer<typeof targetUpsertSchema>;

export const rewardRuleSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    type: z.enum(REWARD_RULE_TYPES).default("ACHIEVEMENT"),
    minAchievementPercent: z.number().min(1).max(1000).nullable().optional(),
    rewardAmount: z.number().positive("Reward amount must be greater than zero"),
    isActive: z.boolean().optional().default(true),
  })
  .refine(
    (d) => d.type !== "ACHIEVEMENT" || (d.minAchievementPercent ?? 0) > 0,
    { message: "Achievement rules need a minimum % (e.g. 100)" }
  );

export type RewardRulePayloadInput = z.infer<typeof rewardRuleSchema>;

export const monthSchema = z.object({
  monthKey: z.string().regex(MONTH_KEY_RE, "Pick a month (YYYY-MM)"),
});

// ---------- target upsert (one per subject per month) ----------

export async function upsertTarget(
  data: TargetUpsertPayload,
  userId: number,
  db: Tx = prisma
): Promise<{ id: number; created: boolean }> {
  const month = monthDateKey(data.monthKey);
  const isUser = data.scope === "USER";

  // Validate the subject exists.
  if (isUser) {
    const u = await db.user.findUnique({
      where: { id: data.userId! },
      select: { id: true, isActive: true },
    });
    if (!u || !u.isActive) throw new AuthzError(400, "User not found");
  } else {
    const t = await db.team.findUnique({
      where: { id: data.teamId! },
      select: { id: true },
    });
    if (!t) throw new AuthzError(400, "Team not found");
  }

  const existing = await db.target.findFirst({
    where: {
      month,
      scope: data.scope,
      ...(isUser ? { userId: data.userId } : { teamId: data.teamId }),
    },
    select: { id: true },
  });

  const values = {
    targetOrders: data.targetOrders,
    targetAmount: data.targetAmount,
    isConfidential: data.isConfidential,
  };

  if (existing) {
    await db.target.update({
      where: { id: existing.id },
      data: { ...values, updatedBy: userId },
    });
    return { id: existing.id, created: false };
  }
  const created = await db.target.create({
    data: {
      month,
      scope: data.scope,
      userId: isUser ? data.userId : null,
      teamId: isUser ? null : data.teamId,
      ...values,
      createdBy: userId,
      updatedBy: userId,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

// ---------- month-close reward computation (SPEC §10) ----------

export interface RewardCandidate {
  userId: number;
  ruleId: number;
  amount: number;
  achievementPercent: number | null;
}

// Decide which rewards a month earns:
//  • ACHIEVEMENT — every user with a target gets the single highest-value active
//    achievement rule whose threshold their primary % (sales value, else orders)
//    meets. Not cumulative — one achievement reward per user.
//  • TOP_SELLER — the month's #1 seller(s) by sales value earn each active
//    top-seller rule (stacks on top of an achievement reward).
export async function computeRewardCandidates(
  monthKey: string,
  db: Tx = prisma
): Promise<RewardCandidate[]> {
  const rules = await db.rewardRule.findMany({ where: { isActive: true } });
  const achievementRules = rules
    .filter((r) => r.type === "ACHIEVEMENT" && r.minAchievementPercent != null)
    .map((r) => ({
      id: r.id,
      minPct: Number(r.minAchievementPercent),
      amount: Number(r.rewardAmount),
    }))
    .sort((a, b) => b.amount - a.amount); // best reward first
  const topSellerRules = rules
    .filter((r) => r.type === "TOP_SELLER")
    .map((r) => ({ id: r.id, amount: Number(r.rewardAmount) }));

  const candidates: RewardCandidate[] = [];

  // Achievement rewards — need a target to measure against.
  if (achievementRules.length) {
    const targets = await db.target.findMany({
      where: { month: monthDateKey(monthKey), scope: "USER", userId: { not: null } },
      select: { userId: true, targetOrders: true, targetAmount: true },
    });
    for (const t of targets) {
      const ach = await aggregateUserAchievement(t.userId!, monthKey, db);
      const targetAmount = t.targetAmount != null ? Number(t.targetAmount) : null;
      const primaryPct =
        targetAmount != null && targetAmount > 0
          ? pctOf(ach.amount, targetAmount)
          : pctOf(ach.orders, t.targetOrders);
      if (primaryPct == null) continue;
      const best = achievementRules.find((r) => primaryPct >= r.minPct);
      if (best) {
        candidates.push({
          userId: t.userId!,
          ruleId: best.id,
          amount: best.amount,
          achievementPercent: primaryPct,
        });
      }
    }
  }

  // Top-seller rewards — the highest sales value on the leaderboard.
  if (topSellerRules.length) {
    const board = await buildLeaderboard(monthKey, db);
    const top = board.filter((r) => r.amountRank === 1 && r.amount > 0);
    for (const rule of topSellerRules) {
      for (const winner of top) {
        candidates.push({
          userId: winner.userId,
          ruleId: rule.id,
          amount: rule.amount,
          achievementPercent: null,
        });
      }
    }
  }

  return candidates;
}

// Persist candidates as PENDING rewards, idempotently. Existing APPROVED/PAID
// rewards are never touched; stale PENDING rows (no longer earned on recompute)
// are removed so re-running converges on the current truth.
export async function computeRewardsForMonth(
  monthKey: string,
  userId: number,
  db: Tx = prisma
): Promise<{ created: number; updated: number; removed: number; pending: number }> {
  const month = monthDateKey(monthKey);
  const candidates = await computeRewardCandidates(monthKey, db);
  const wanted = new Map(candidates.map((c) => [`${c.userId}:${c.ruleId}`, c]));

  const existing = await db.reward.findMany({ where: { month } });
  let created = 0;
  let updated = 0;
  let removed = 0;

  for (const ex of existing) {
    const key = `${ex.userId}:${ex.ruleId}`;
    const want = wanted.get(key);
    if (!want) {
      // No longer earned — drop only if still pending.
      if (ex.status === "PENDING") {
        await db.reward.delete({ where: { id: ex.id } });
        removed++;
      }
      continue;
    }
    // Already recorded; refresh the pending ones' numbers.
    if (ex.status === "PENDING") {
      await db.reward.update({
        where: { id: ex.id },
        data: {
          amount: want.amount,
          achievementPercent: want.achievementPercent,
          updatedBy: userId,
        },
      });
      updated++;
    }
    wanted.delete(key);
  }

  for (const want of wanted.values()) {
    await db.reward.create({
      data: {
        userId: want.userId,
        month,
        ruleId: want.ruleId,
        amount: want.amount,
        achievementPercent: want.achievementPercent,
        status: "PENDING",
        createdBy: userId,
        updatedBy: userId,
      },
    });
    created++;
  }

  const pending = await db.reward.count({ where: { month, status: "PENDING" } });
  return { created, updated, removed, pending };
}

// The shared "Reward/Bonus" expense category (VARIABLE), created on demand like
// the courier/purchase categories.
export async function ensureRewardCategoryId(db: Tx): Promise<number> {
  const category = await db.expenseCategory.upsert({
    where: { name: REWARD_EXPENSE_CATEGORY },
    update: {},
    create: { name: REWARD_EXPENSE_CATEGORY, costType: "VARIABLE" },
  });
  return category.id;
}

// SPEC §10 — Admin approval books the reward as an expense (category
// "Reward/Bonus", ref → this reward) and links it back. Must run in a
// transaction so the reward flip and the expense insert commit together.
export async function approveReward(
  rewardId: number,
  userId: number,
  now: Date,
  tx: Prisma.TransactionClient
): Promise<{ expenseId: number }> {
  const reward = await tx.reward.findUnique({
    where: { id: rewardId },
    include: { rule: { select: { name: true } }, user: { select: { name: true } } },
  });
  if (!reward) throw new AuthzError(404, "Reward not found");
  if (reward.status !== "PENDING") {
    throw new AuthzError(400, `Reward is already ${reward.status.toLowerCase()}`);
  }

  const categoryId = await ensureRewardCategoryId(tx);
  const monthKey = reward.month.toISOString().slice(0, 7);
  const expense = await tx.expense.create({
    data: {
      // Cash-basis: the cost lands when it's approved (Asia/Dhaka today). Stored
      // as UTC-midnight of the Dhaka day so the @db.Date column reads back as
      // that calendar day (a +06:00 instant would round down to the day before).
      expenseDate: new Date(`${dhakaYmd(now)}T00:00:00.000Z`),
      categoryId,
      amount: reward.amount,
      notes: `Reward: ${reward.rule.name} — ${reward.user.name} (${monthKey})`,
      refTable: "rewards",
      refId: reward.id,
      createdBy: userId,
      updatedBy: userId,
    },
    select: { id: true },
  });

  await tx.reward.update({
    where: { id: reward.id },
    data: {
      status: "APPROVED",
      approvedBy: userId,
      approvedAt: now,
      expenseId: expense.id,
      updatedBy: userId,
    },
  });
  return { expenseId: expense.id };
}

// Reject = discard a pending computed reward. Approved/paid ones can't be undone
// here (the expense is already booked).
export async function rejectReward(
  rewardId: number,
  db: Tx = prisma
): Promise<void> {
  const reward = await db.reward.findUnique({
    where: { id: rewardId },
    select: { status: true },
  });
  if (!reward) throw new AuthzError(404, "Reward not found");
  if (reward.status !== "PENDING") {
    throw new AuthzError(400, "Only pending rewards can be rejected");
  }
  await db.reward.delete({ where: { id: rewardId } });
}

// Mark an approved reward as actually disbursed.
export async function markRewardPaid(
  rewardId: number,
  userId: number,
  db: Tx = prisma
): Promise<void> {
  const reward = await db.reward.findUnique({
    where: { id: rewardId },
    select: { status: true },
  });
  if (!reward) throw new AuthzError(404, "Reward not found");
  if (reward.status !== "APPROVED") {
    throw new AuthzError(400, "Only approved rewards can be marked paid");
  }
  await db.reward.update({
    where: { id: rewardId },
    data: { status: "PAID", updatedBy: userId },
  });
}

// A user's own reward history (their profile reward record, §10). Amounts of a
// user's OWN rewards are visible to them.
export async function getUserRewards(userId: number, db: Tx = prisma) {
  return db.reward.findMany({
    where: { userId },
    include: REWARD_INCLUDE,
    orderBy: [{ month: "desc" }, { id: "desc" }],
  });
}

// YYYY-MM-DD (Asia/Dhaka) — office day for the expense date.
function dhakaYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(d);
}

export { monthKeyOf };
