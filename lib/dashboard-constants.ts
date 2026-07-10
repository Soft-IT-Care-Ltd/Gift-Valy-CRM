// Owner Dashboard — client-safe constants (SPEC §13).
// The date-range switch (Today / This week / This month / Custom) lives in a
// client component, so its keys/labels must import zero server code.

export const DASH_RANGES = ["today", "week", "month", "custom"] as const;
export type DashRangeKey = (typeof DASH_RANGES)[number];

export const DASH_RANGE_LABELS: Record<DashRangeKey, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  custom: "Custom",
};

// Possessive form used on the money tiles ("Today's sales" → "This week's sales").
export const DASH_RANGE_POSSESSIVE: Record<DashRangeKey, string> = {
  today: "Today's",
  week: "This week's",
  month: "This month's",
  custom: "Selected range",
};

export function isDashRange(v: string | undefined): v is DashRangeKey {
  return !!v && (DASH_RANGES as readonly string[]).includes(v);
}
