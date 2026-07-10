import { prisma } from "./db";

// SPEC §14 settings table — JSON values keyed by string. Missing keys fall
// back to code defaults so no seed row is required.
export const SETTING_KEYS = {
  orderEditWindowMinutes: "order_edit_window_minutes",
  onboardingExcludeDays: "onboarding_exclude_days",
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
