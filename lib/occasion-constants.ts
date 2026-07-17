// CORRECTIONS Orders §7 (C8) — client-safe occasion recurrence + period presets
// for the Occasions menu and the SE reminder widget. Occasions (birthday /
// anniversary) RECUR every year, so unlike the delivery-schedule presets these
// look at the NEXT annual occurrence of a stored month-day, always forward from
// today. Every range is an Asia/Dhaka calendar window emitted as YYYY-MM-DD.
// No server imports — safe to pull into "use client" components.

import { fmtDayMonth } from "./delivery-schedule";

export { fmtDayMonth };

// Filters per CORRECTIONS: Today, Tomorrow, Next 7 days, This Month, Custom.
// (No "Next Month" — occasions are pitched close to the date.)
export const OCCASION_PERIODS = [
  "today",
  "tomorrow",
  "next7",
  "month",
  "custom",
] as const;

export type OccasionPeriod = (typeof OCCASION_PERIODS)[number];

export const OCCASION_PERIOD_LABELS: Record<OccasionPeriod, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  next7: "Next 7 days",
  month: "This Month",
  custom: "Custom",
};

// Default reminder lead time (days before the occasion) when no setting is saved.
export const DEFAULT_OCCASION_LEAD_DAYS = 7;

export type OccasionType = "Birthday" | "Anniversary";

// One computed occasion (birthday or anniversary) for the list / reminders.
// Defined here (client-safe) so both the server engine and the "use client"
// components share the shape without pulling the server module client-side.
export interface OccasionRow {
  occasionId: number; // customer_occasions.id (the profile row)
  type: OccasionType;
  customerId: number;
  customerName: string;
  customerPhone: string; // foreign number (WhatsApp)
  country: string;
  recipientName: string;
  recipientPhoneBd: string;
  relation: string | null;
  date: string; // stored occasion date, YYYY-MM-DD
  nextOccurrence: string; // next annual occurrence, YYYY-MM-DD
  daysRemaining: number; // whole days from today to nextOccurrence
  lastOrder: {
    id: number;
    orderNo: string;
    date: string; // YYYY-MM-DD
    total: number;
  } | null;
}

// ---------- Dhaka calendar helpers ----------

function dhakaTodayParts(): { y: number; m: number; d: number } {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" })
    .format(new Date())
    .split("-")
    .map(Number);
  return { y, m, d };
}

// Calendar math at a fixed UTC noon — day offsets can't cross a date line.
function ymd(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d, 12)).toISOString().slice(0, 10);
}

export function occasionToday(): string {
  const { y, m, d } = dhakaTodayParts();
  return ymd(y, m, d);
}

// Days in a given month/year (for Feb-29 clamping on non-leap years).
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
}

// ---------- annual recurrence ----------

// The next calendar day (YYYY-MM-DD, Dhaka) on/after `fromYmd` whose month/day
// matches the stored occasion. Feb-29 birthdays land on Feb-28 in non-leap
// years. Only this year and next are candidates — one is always ≥ fromYmd.
export function nextOccurrenceYmd(
  month: number,
  day: number,
  fromYmd: string
): string {
  const fromYear = Number(fromYmd.slice(0, 4));
  for (const y of [fromYear, fromYear + 1]) {
    const occ = ymd(y, month, Math.min(day, daysInMonth(y, month)));
    if (occ >= fromYmd) return occ;
  }
  // Unreachable in practice; keeps the return type total.
  return ymd(fromYear + 1, month, Math.min(day, daysInMonth(fromYear + 1, month)));
}

// Whole days between two YYYY-MM-DD strings (b − a). Uses UTC noon so DST/tz
// never shifts the count.
export function daysBetweenYmd(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ms =
    Date.UTC(by, bm - 1, bd, 12) - Date.UTC(ay, am - 1, ad, 12);
  return Math.round(ms / 86_400_000);
}

// ---------- period ranges ----------

// Concrete forward-looking from/to for a preset. "custom" returns empty strings
// (the caller supplies dates). "month" runs from today to the end of the current
// month (never before today — past occasions aren't pitchable).
export function occasionPeriodRange(preset: OccasionPeriod): {
  from: string;
  to: string;
} {
  const { y, m, d } = dhakaTodayParts();
  const today = ymd(y, m, d);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "tomorrow": {
      const x = ymd(y, m, d + 1);
      return { from: x, to: x };
    }
    case "next7":
      return { from: today, to: ymd(y, m, d + 6) };
    case "month":
      return { from: today, to: ymd(y, m, daysInMonth(y, m)) };
    default:
      return { from: "", to: "" };
  }
}

// Restore the dropdown selection from URL params after a reload.
export function detectOccasionPeriod(
  from: string,
  to: string,
  emptyMeans: OccasionPeriod
): OccasionPeriod {
  if (!from && !to) return emptyMeans;
  for (const p of OCCASION_PERIODS) {
    if (p === "custom") continue;
    const r = occasionPeriodRange(p);
    if (r.from === from && r.to === to) return p;
  }
  return "custom";
}

// "in 3 days" / "today" / "tomorrow" — the days-remaining chip label.
export function daysRemainingLabel(days: number): string {
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days} days`;
}

// CORRECTIONS Orders §7 — the Bangla pitch the SE fires from the Follow up
// action ("আপনার প্রিয়জনের birthday আসছে — এবারও gift পাঠাবেন?").
export function occasionFollowUpText(input: {
  customerName: string;
  recipientName: string;
  type: OccasionType;
  nextOccurrence: string;
}): string {
  const occ = input.type === "Birthday" ? "birthday" : "anniversary";
  return (
    `আসসালামু আলাইকুম ${input.customerName}। ` +
    `${input.recipientName}-এর ${occ} (${fmtDayMonth(input.nextOccurrence)}) ` +
    `আসছে — এবারও কি Gift Valy থেকে একটা সুন্দর gift পাঠাবেন? ` +
    `আমরা সাজিয়ে দিচ্ছি! 🎁`
  );
}
