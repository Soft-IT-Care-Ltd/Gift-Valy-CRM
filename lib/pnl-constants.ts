// Accounting & Profit/Loss constants — SPEC §9.2 / §9.3 (Module 7, report R9).
// Client-safe: no Prisma/server imports, so the settings form, API routes, the
// P&L report clients and the verify script share one source of truth (mirrors
// lib/expense-constants.ts / lib/attendance-constants.ts). The server builders
// live in lib/pnl.ts and export their result types for `import type` reuse.

export const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- ad-cost allocation (SPEC §9.2) ----------
// Per-order profit subtracts an allocated share of the day's ad spend. The
// method is a setting: `daily_average` (default) spreads that day's ad spend
// evenly across that day's confirmed orders; `manual_percent` charges a flat
// percentage of each order's sell value instead.
export const AD_ALLOCATION_METHODS = ["daily_average", "manual_percent"] as const;
export type AdAllocationMethod = (typeof AD_ALLOCATION_METHODS)[number];

export const AD_ALLOCATION_LABELS: Record<AdAllocationMethod, string> = {
  daily_average: "Per-order daily average",
  manual_percent: "Manual % of sell value",
};

export const AD_ALLOCATION_HELP: Record<AdAllocationMethod, string> = {
  daily_average:
    "That day's total ad spend ÷ that day's confirmed orders (SPEC §9.2 default).",
  manual_percent:
    "A flat percentage of each order's sell value is charged as its ad cost.",
};

// ---------- revenue recognition basis (SPEC §9.2 "delivered/confirmed toggle") ----------
export const REVENUE_BASES = ["confirmed", "delivered"] as const;
export type RevenueBasis = (typeof REVENUE_BASES)[number];

export const REVENUE_BASIS_LABELS: Record<RevenueBasis, string> = {
  confirmed: "Confirmed (booked when the order is confirmed)",
  delivered: "Delivered (recognised when the goods are delivered)",
};

// ---------- settings (SPEC §14 key/value) ----------

export const PNL_SETTINGS_KEY = "pnl_settings";

export interface PnlSettings {
  // Standard packaging cost charged to every order in the per-order profit calc
  // (SPEC §9.2 "packaging cost (standard per-order rate, setting)"). BDT.
  packagingCostPerOrder: number;
  adAllocationMethod: AdAllocationMethod;
  // % of sell value charged as ad cost when adAllocationMethod = manual_percent.
  adManualPercent: number;
}

export const DEFAULT_PNL_SETTINGS: PnlSettings = {
  packagingCostPerOrder: 0,
  adAllocationMethod: "daily_average",
  adManualPercent: 0,
};

// Fill missing/invalid fields from defaults so a fresh install (no setting row)
// still computes profit, and a partial PUT can't corrupt the stored value.
export function normalizePnlSettings(
  raw: Partial<PnlSettings> | null | undefined
): PnlSettings {
  const d = DEFAULT_PNL_SETTINGS;
  const method =
    raw?.adAllocationMethod &&
    AD_ALLOCATION_METHODS.includes(raw.adAllocationMethod)
      ? raw.adAllocationMethod
      : d.adAllocationMethod;
  const packaging = Number(raw?.packagingCostPerOrder);
  const percent = Number(raw?.adManualPercent);
  return {
    packagingCostPerOrder:
      Number.isFinite(packaging) && packaging >= 0 ? round2(packaging) : d.packagingCostPerOrder,
    adAllocationMethod: method,
    adManualPercent:
      Number.isFinite(percent) && percent >= 0 && percent <= 100
        ? round2(percent)
        : d.adManualPercent,
  };
}
