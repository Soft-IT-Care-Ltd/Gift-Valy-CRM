import { prisma } from "./db";
import {
  DEFAULT_OVERCHARGE_TOLERANCE_PCT,
  DEFAULT_STUCK_AMBER_DAYS,
  DEFAULT_STUCK_RED_DAYS,
} from "./courier-constants";
import { DEFAULT_OCCASION_LEAD_DAYS } from "./occasion-constants";
import {
  INVOICE_BRANDING_KEY,
  normalizeInvoiceBranding,
  type InvoiceBranding,
} from "./invoice-branding-constants";

// SPEC §14 settings table — JSON values keyed by string. Missing keys fall
// back to code defaults so no seed row is required.
export const SETTING_KEYS = {
  orderEditWindowMinutes: "order_edit_window_minutes",
  onboardingExcludeDays: "onboarding_exclude_days",
  courierOverchargeTolerancePct: "courier_overcharge_tolerance_pct",
  // CORRECTIONS Orders §R6 — stuck-parcel escalation thresholds (days).
  courierStuckAmberDays: "courier_stuck_amber_days",
  courierStuckRedDays: "courier_stuck_red_days",
  // CORRECTIONS Orders §7 (C8) — how many days BEFORE an occasion the reminder
  // starts surfacing in the SE follow-up area.
  occasionReminderLeadDays: "occasion_reminder_lead_days",
  // CORRECTIONS Orders §R8 — the bank wallet Steadfast payouts are deposited
  // into. A paid payment's COD rows land here (gross in) and its two charge
  // expenses draw from here (out), so the wallet's running balance moves by
  // exactly the NET payout.
  steadfastPayoutWalletId: "steadfast_payout_wallet_id",
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

// CORRECTIONS Orders §R6 — the amber/red day thresholds for the stuck-parcel
// Duration badge (and the stuck-parcels count). Admin sets them on the Courier
// page; defaults 3d / 5d. red is floored to at least amber so the escalation
// never inverts if mis-configured.
export interface StuckThresholds {
  amberDays: number;
  redDays: number;
}

export async function getCourierStuckThresholds(): Promise<StuckThresholds> {
  const [amberDays, redDaysRaw] = await Promise.all([
    getNumberSetting(SETTING_KEYS.courierStuckAmberDays, DEFAULT_STUCK_AMBER_DAYS),
    getNumberSetting(SETTING_KEYS.courierStuckRedDays, DEFAULT_STUCK_RED_DAYS),
  ]);
  return { amberDays, redDays: Math.max(redDaysRaw, amberDays) };
}

// CORRECTIONS §R9 — the invoice letterhead/footer branding. Missing row or
// fields → the historical hard-coded look (DEFAULT_INVOICE_BRANDING), so
// invoices render identically until Admin edits the settings.
export async function getInvoiceBranding(): Promise<InvoiceBranding> {
  const row = await prisma.setting.findUnique({
    where: { key: INVOICE_BRANDING_KEY },
  });
  return normalizeInvoiceBranding(row?.value ?? null);
}

// CORRECTIONS Orders §R8 — the Steadfast payout wallet. Returns null when unset
// or when the configured wallet was deleted/deactivated — the sync then records
// COD rows unattributed (they surface as "unassigned collected" on the wallet
// report) rather than pointing money at a dead wallet.
export async function getSteadfastPayoutWalletId(): Promise<number | null> {
  const row = await prisma.setting.findUnique({
    where: { key: SETTING_KEYS.steadfastPayoutWalletId },
  });
  const id = typeof row?.value === "number" ? row.value : null;
  if (!id) return null;
  const wallet = await prisma.wallet.findUnique({
    where: { id },
    select: { isActive: true },
  });
  return wallet?.isActive ? id : null;
}

// CORRECTIONS Orders §7 (C8) — occasion reminder lead time (days before the
// date). Admin sets it in Settings → Occasion Reminders; default 7 days.
// Floored to 0 so a mis-typed negative never hides today's occasions.
export async function getOccasionReminderLeadDays(): Promise<number> {
  const days = await getNumberSetting(
    SETTING_KEYS.occasionReminderLeadDays,
    DEFAULT_OCCASION_LEAD_DAYS
  );
  return Math.max(0, Math.round(days));
}
