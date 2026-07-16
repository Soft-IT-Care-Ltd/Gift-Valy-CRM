// Owner Dashboard — client-safe constants (SPEC §13).
// The date-range filter (Today / Yesterday / This Week / This Month /
// Last Month / Custom) lives in a client component, so its keys/labels must
// import zero server code. Keys match the app-wide DateFilterPreset values.

export const DASH_RANGES = [
  "today",
  "yesterday",
  "week",
  "month",
  "lastmonth",
  "custom",
] as const;
export type DashRangeKey = (typeof DASH_RANGES)[number];

export const DASH_RANGE_LABELS: Record<DashRangeKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This Week",
  month: "This Month",
  lastmonth: "Last Month",
  custom: "Custom",
};

// Possessive form used on the money tiles ("Today's sales" → "This week's sales").
export const DASH_RANGE_POSSESSIVE: Record<DashRangeKey, string> = {
  today: "Today's",
  yesterday: "Yesterday's",
  week: "This week's",
  month: "This month's",
  lastmonth: "Last month's",
  custom: "Selected range",
};

export function isDashRange(v: string | undefined): v is DashRangeKey {
  return !!v && (DASH_RANGES as readonly string[]).includes(v);
}
