// App-wide date-range filter presets — Today / Yesterday / This Week /
// This Month / Last Month / Custom (+ optional All Time). Client-safe, no
// server imports. Every range is an Asia/Dhaka calendar window emitted as
// YYYY-MM-DD strings, so the viewer's own timezone never shifts the dates.

export const DATE_FILTER_PRESETS = [
  "today",
  "yesterday",
  "week",
  "month",
  "lastmonth",
  "custom",
] as const;

export type DateFilterPreset = (typeof DATE_FILTER_PRESETS)[number] | "all";

export const DATE_FILTER_LABELS: Record<DateFilterPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This Week",
  month: "This Month",
  lastmonth: "Last Month",
  custom: "Custom",
  all: "All Time",
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

// Concrete from/to for a preset. "custom" and "all" return empty strings —
// the caller supplies (or omits) the dates.
export function presetRange(preset: DateFilterPreset): {
  from: string;
  to: string;
} {
  const { y, m, d } = dhakaTodayParts();
  const today = ymdShift(y, m, d, 0);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const x = ymdShift(y, m, d, -1);
      return { from: x, to: x };
    }
    case "week": {
      // Week starts Sunday (Bangladesh work week, Fri–Sat weekend).
      const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
      return { from: ymdShift(y, m, d, -dow), to: today };
    }
    case "month":
      return { from: ymdShift(y, m, 1, 0), to: today };
    case "lastmonth":
      return { from: ymdShift(y, m - 1, 1, 0), to: ymdShift(y, m, 1, -1) };
    default:
      return { from: "", to: "" };
  }
}

// Which preset do these concrete dates correspond to? Restores the dropdown
// selection from URL params / state after a reload. `emptyMeans` is what an
// unset range means on the calling page ("month" where the server defaults
// to this month, "all" where it shows everything).
export function detectPreset(
  from: string,
  to: string,
  emptyMeans: DateFilterPreset
): DateFilterPreset {
  if (!from && !to) return emptyMeans;
  for (const p of DATE_FILTER_PRESETS) {
    if (p === "custom") continue;
    const r = presetRange(p);
    if (r.from === from && r.to === to) return p;
  }
  return "custom";
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtDayMonth(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

// Short range caption shown under the preset name, e.g. "1 Jul – 13 Jul".
export function presetSubLabel(
  preset: DateFilterPreset,
  custom: { from: string; to: string }
): string {
  if (preset === "all") return "";
  const r = preset === "custom" ? custom : presetRange(preset);
  if (!r.from || !r.to) return "Pick dates";
  return r.from === r.to
    ? fmtDayMonth(r.from)
    : `${fmtDayMonth(r.from)} – ${fmtDayMonth(r.to)}`;
}
