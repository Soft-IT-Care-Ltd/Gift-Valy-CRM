import { prisma } from "./db";
import { DEFAULT_OVERCHARGE_TOLERANCE_PCT } from "./courier-constants";

// SPEC §14 settings table — JSON values keyed by string. Missing keys fall
// back to code defaults so no seed row is required.
export const SETTING_KEYS = {
  orderEditWindowMinutes: "order_edit_window_minutes",
  onboardingExcludeDays: "onboarding_exclude_days",
  courierOverchargeTolerancePct: "courier_overcharge_tolerance_pct",
} as const;

// SPEC §10 default onboarding grace: new joiners excluded from team aggregates
// for their first 30 days.
export const DEFAULT_ONBOARDING_EXCLUDE_DAYS = 30;

export async function getNumberSetting(
  key: string,
  fallback: number
): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return typeof row?.value === "number" ? row.value : fallback;
}

// SPEC §4.2 — SE self-edit window after order creation, default 30 minutes.
export async function getOrderEditWindowMinutes(): Promise<number> {
  return getNumberSetting(SETTING_KEYS.orderEditWindowMinutes, 30);
}

// SPEC §10 — a user flagged `is_onboarding` is excluded from team aggregate
// targets for their first N days after joining (configurable).
export async function getOnboardingExcludeDays(): Promise<number> {
  return getNumberSetting(
    SETTING_KEYS.onboardingExcludeDays,
    DEFAULT_ONBOARDING_EXCLUDE_DAYS
  );
}

// CORRECTIONS Orders §R4 — how much higher Steadfast's counted weight/charge may
// be than our own figure before the In Transit tab flags it as an overcharge
// (percent). Admin sets it on the Courier page; default 10%.
export async function getCourierOverchargeTolerancePct(): Promise<number> {
  return getNumberSetting(
    SETTING_KEYS.courierOverchargeTolerancePct,
    DEFAULT_OVERCHARGE_TOLERANCE_PCT
  );
}
