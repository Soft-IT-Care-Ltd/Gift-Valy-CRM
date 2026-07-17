// CORRECTIONS Orders §2 / Stock §1 — the FORWARD-looking delivery-period presets
// shared by the Delivery Schedule view and the Delivery Requirement Planner.
// Distinct from the backward-looking app date filter (lib/date-filter.ts): these
// look at requested delivery dates ahead of today. Client-safe (no server
// imports). Every range is an Asia/Dhaka calendar window emitted as YYYY-MM-DD.

export const DELIVERY_PERIODS = [
  "today",
  "tomorrow",
  "next7",
  "month",
  "nextmonth",
  "custom",
] as const;

export type DeliveryPeriod = (typeof DELIVERY_PERIODS)[number];

export const DELIVERY_PERIOD_LABELS: Record<DeliveryPeriod, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  next7: "Next 7 days",
  month: "This Month",
  nextmonth: "Next Month",
  custom: "Custom",
};

// Today's year/month/day on the Dhaka calendar.
function dhakaTodayParts(): { y: number; m: number; d: number } {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" })
    .format(new Date())
    .split("-")
    .map(Number);
  return { y, m, d };
}

// Calendar math at a fixed UTC noon — day offsets can't cross a date line.
function ymdShift(y: number, m: number, d: number, days: number): string {
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

// Today / tomorrow as YYYY-MM-DD (Dhaka) — used for grouping + late-risk.
export function dhakaToday(): string {
  const { y, m, d } = dhakaTodayParts();
  return ymdShift(y, m, d, 0);
}

export function dhakaTomorrow(): string {
  const { y, m, d } = dhakaTodayParts();
  return ymdShift(y, m, d, 1);
}

// Concrete from/to for a period. "custom" returns empty strings — the caller
// supplies the dates. Ranges are forward-looking (never before today) except
// "month", which spans the whole current calendar month.
export function deliveryPeriodRange(preset: DeliveryPeriod): {
  from: string;
  to: string;
} {
  const { y, m, d } = dhakaTodayParts();
  const today = ymdShift(y, m, d, 0);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "tomorrow": {
      const x = ymdShift(y, m, d, 1);
      return { from: x, to: x };
    }
    case "next7":
      return { from: today, to: ymdShift(y, m, d, 6) };
    case "month":
      // Whole current month (past days included so overdue fixed dates surface).
      return { from: ymdShift(y, m, 1, 0), to: ymdShift(y, m + 1, 1, -1) };
    case "nextmonth":
      return { from: ymdShift(y, m + 1, 1, 0), to: ymdShift(y, m + 2, 1, -1) };
    default:
      return { from: "", to: "" };
  }
}

// Which preset do these concrete dates correspond to? Restores the dropdown
// selection from URL params after a reload; defaults to `emptyMeans` when unset.
export function detectDeliveryPeriod(
  from: string,
  to: string,
  emptyMeans: DeliveryPeriod
): DeliveryPeriod {
  if (!from && !to) return emptyMeans;
  for (const p of DELIVERY_PERIODS) {
    if (p === "custom") continue;
    const r = deliveryPeriodRange(p);
    if (r.from === from && r.to === to) return p;
  }
  return "custom";
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// "13 Jul" from a YYYY-MM-DD.
export function fmtDayMonth(ymd: string): string {
  const [, mm, dd] = ymd.split("-").map(Number);
  return `${dd} ${MONTHS_SHORT[mm - 1]}`;
}

// "Tue, 13 Jul" — the group heading for a delivery date.
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtWeekdayDate(ymd: string): string {
  const [yy, mm, dd] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(yy, mm - 1, dd, 12)).getUTCDay();
  return `${WEEKDAYS_SHORT[dow]}, ${fmtDayMonth(ymd)}`;
}
