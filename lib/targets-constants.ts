// Targets & Rewards constants, serializers and pure gauge math — SPEC §10.
// Client-safe: only `import type` from Prisma, so forms, API routes, the manage
// UI and the verify script share one source of truth (mirrors lib/expense-
// constants.ts). No server (prisma) imports here.
import type { Prisma } from "@prisma/client";

// ---------- enums / labels ----------

export const TARGET_SCOPES = ["USER", "TEAM"] as const;
export type TargetScopeValue = (typeof TARGET_SCOPES)[number];

export const REWARD_RULE_TYPES = ["ACHIEVEMENT", "TOP_SELLER"] as const;
export type RewardRuleTypeValue = (typeof REWARD_RULE_TYPES)[number];

export const REWARD_RULE_TYPE_LABELS: Record<RewardRuleTypeValue, string> = {
  ACHIEVEMENT: "Target achievement %",
  TOP_SELLER: "Top seller of month",
};

export const REWARD_STATUSES = ["PENDING", "APPROVED", "PAID"] as const;
export type RewardStatusValue = (typeof REWARD_STATUSES)[number];

export const REWARD_STATUS_LABELS: Record<RewardStatusValue, string> = {
  PENDING: "Pending approval",
  APPROVED: "Approved",
  PAID: "Paid",
};

// The expense category month-close rewards are booked under (§9.1 seed / §10).
export const REWARD_EXPENSE_CATEGORY = "Reward/Bonus";

// ---------- month helpers (pure) ----------

// "YYYY-MM" of a Date, in Asia/Dhaka (the office month).
export function monthKeyOf(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  return `${y}-${m}`;
}

export const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

// Human-readable month label, e.g. "July 2026".
export function monthLabel(monthKey: string): string {
  return new Date(`${monthKey}-01T00:00:00+06:00`).toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    month: "long",
    year: "numeric",
  });
}

// achieved / target as a percentage rounded to 2 dp; null when there is no
// (positive) target to measure against.
export function pctOf(achieved: number, target: number | null): number | null {
  if (target == null || target <= 0) return null;
  return Math.round((achieved / target) * 10000) / 100;
}

// ---------- live progress gauge (SPEC §10) ----------

export interface Gauge {
  scope: TargetScopeValue;
  subjectId: number;
  subjectName: string;
  isConfidential: boolean;
  targetId: number | null;
  targetOrders: number | null;
  targetAmount: number | null;
  achievedOrders: number;
  achievedAmount: number;
  ordersPct: number | null;
  amountPct: number | null;
  // The % rewards are judged on: sales value when an amount target is set,
  // otherwise order count (§10 reward rules).
  primaryPct: number | null;
  daysInMonth: number;
  dayOfMonth: number;
  daysLeft: number;
  requiredDailyOrders: number | null;
  requiredDailyAmount: number | null;
  isCurrentMonth: boolean;
  isPastMonth: boolean;
  // Team gauges only — how many onboarding members were left out (§10).
  onboardingExcludedCount?: number;
}

export interface GaugeInput {
  scope: TargetScopeValue;
  subjectId: number;
  subjectName: string;
  isConfidential: boolean;
  targetId: number | null;
  targetOrders: number | null;
  targetAmount: number | null;
  achievedOrders: number;
  achievedAmount: number;
  monthKey: string;
  now: Date;
  onboardingExcludedCount?: number;
}

// Assemble a progress gauge from raw achieved/target numbers. Pure: all the
// date arithmetic is derived from `monthKey` + `now` so it is deterministic and
// testable. "Days left" counts today as still workable; the required daily
// run-rate spreads the remaining target over those days.
export function assembleGauge(input: GaugeInput): Gauge {
  const {
    targetOrders,
    targetAmount,
    achievedOrders,
    achievedAmount,
    monthKey,
    now,
  } = input;

  const [ty, tm] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(ty, tm, 0)).getUTCDate();

  // Today in Dhaka.
  const todayKey = monthKeyOf(now);
  const dayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
  }).formatToParts(now).find((p) => p.type === "day")!.value;
  const todayDom = Number(dayStr);

  const isCurrentMonth = todayKey === monthKey;
  const isPastMonth = todayKey > monthKey;

  let dayOfMonth: number;
  let daysLeft: number;
  if (isCurrentMonth) {
    dayOfMonth = todayDom;
    daysLeft = daysInMonth - todayDom + 1; // today still counts
  } else if (isPastMonth) {
    dayOfMonth = daysInMonth;
    daysLeft = 0;
  } else {
    dayOfMonth = 0;
    daysLeft = daysInMonth;
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const runRate = (target: number | null, achieved: number): number | null => {
    if (target == null || daysLeft <= 0) return null;
    const remaining = Math.max(target - achieved, 0);
    return round2(remaining / daysLeft);
  };

  const ordersPct = pctOf(achievedOrders, targetOrders);
  const amountPct = pctOf(achievedAmount, targetAmount);
  const primaryPct =
    targetAmount != null && targetAmount > 0 ? amountPct : ordersPct;

  return {
    scope: input.scope,
    subjectId: input.subjectId,
    subjectName: input.subjectName,
    isConfidential: input.isConfidential,
    targetId: input.targetId,
    targetOrders,
    targetAmount,
    achievedOrders,
    achievedAmount,
    ordersPct,
    amountPct,
    primaryPct,
    daysInMonth,
    dayOfMonth,
    daysLeft,
    requiredDailyOrders: runRate(targetOrders, achievedOrders),
    requiredDailyAmount: runRate(targetAmount, achievedAmount),
    isCurrentMonth,
    isPastMonth,
    onboardingExcludedCount: input.onboardingExcludedCount,
  };
}

// ---------- leaderboard (SPEC §10 — visible to all, values only) ----------

export interface LeaderboardRow {
  userId: number;
  name: string;
  teamName: string | null;
  isOnboarding: boolean;
  orders: number;
  amount: number;
  amountRank: number;
  ordersRank: number;
}

// ---------- serializers ----------

export type TargetWithSubject = Prisma.TargetGetPayload<{
  include: {
    user: { select: { id: true; name: true } };
    team: { select: { id: true; name: true } };
  };
}>;

export interface TargetRow {
  id: number;
  monthKey: string;
  scope: TargetScopeValue;
  subjectId: number;
  subjectName: string;
  targetOrders: number | null;
  targetAmount: number | null;
  isConfidential: boolean;
}

export function serializeTarget(t: TargetWithSubject): TargetRow {
  return {
    id: t.id,
    monthKey: t.month.toISOString().slice(0, 7),
    scope: t.scope as TargetScopeValue,
    subjectId: t.scope === "USER" ? t.user!.id : t.team!.id,
    subjectName: t.scope === "USER" ? t.user!.name : t.team!.name,
    targetOrders: t.targetOrders,
    targetAmount: t.targetAmount != null ? Number(t.targetAmount) : null,
    isConfidential: t.isConfidential,
  };
}

export type RewardRulePayload = Prisma.RewardRuleGetPayload<object>;

export interface RewardRuleRow {
  id: number;
  name: string;
  type: RewardRuleTypeValue;
  minAchievementPercent: number | null;
  rewardAmount: number;
  isActive: boolean;
}

export function serializeRewardRule(r: RewardRulePayload): RewardRuleRow {
  return {
    id: r.id,
    name: r.name,
    type: r.type as RewardRuleTypeValue,
    minAchievementPercent:
      r.minAchievementPercent != null ? Number(r.minAchievementPercent) : null,
    rewardAmount: Number(r.rewardAmount),
    isActive: r.isActive,
  };
}

export type RewardWithRefs = Prisma.RewardGetPayload<{
  include: {
    user: { select: { id: true; name: true } };
    rule: { select: { id: true; name: true; type: true } };
  };
}>;

export interface RewardRow {
  id: number;
  userId: number;
  userName: string;
  monthKey: string;
  ruleId: number;
  ruleName: string;
  ruleType: RewardRuleTypeValue;
  amount: number;
  achievementPercent: number | null;
  status: RewardStatusValue;
  approvedAt: string | null;
  expenseId: number | null;
}

export function serializeReward(r: RewardWithRefs): RewardRow {
  return {
    id: r.id,
    userId: r.user.id,
    userName: r.user.name,
    monthKey: r.month.toISOString().slice(0, 7),
    ruleId: r.rule.id,
    ruleName: r.rule.name,
    ruleType: r.rule.type as RewardRuleTypeValue,
    amount: Number(r.amount),
    achievementPercent:
      r.achievementPercent != null ? Number(r.achievementPercent) : null,
    status: r.status as RewardStatusValue,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    expenseId: r.expenseId,
  };
}

export const REWARD_INCLUDE = {
  user: { select: { id: true, name: true } },
  rule: { select: { id: true, name: true, type: true } },
} satisfies Prisma.RewardInclude;

export const TARGET_INCLUDE = {
  user: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
} satisfies Prisma.TargetInclude;
