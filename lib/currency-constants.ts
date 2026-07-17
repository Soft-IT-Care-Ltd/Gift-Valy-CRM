// SPEC §5 — customer-currency display on invoices. Pure types + conversion
// helpers, safe for client and server (no prisma). All stored money stays BDT;
// these only produce the "approx." display at the Admin-maintained rate.

export interface CurrencyDisplay {
  code: string; // ISO 4217, e.g. SAR
  symbol: string | null; // optional; code is used when absent
  bdtPerUnit: number; // ৳ per 1 unit of the currency
}

// The serialized rate row the settings UI works with.
export interface CurrencyRateRow {
  id: number;
  code: string;
  name: string;
  symbol: string | null;
  bdtPerUnit: number;
  countries: string[];
  isActive: boolean;
  updatedAt: string;
}

// ৳ → customer currency, 2dp with en-US grouping: "SAR 107.69".
export function formatInCurrency(bdt: number, rate: CurrencyDisplay): string {
  const v = bdt / rate.bdtPerUnit;
  return `${rate.symbol ?? rate.code} ${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// "1 SAR = ৳32.50" — the disclosure line printed next to any approximation.
export function rateLine(rate: CurrencyDisplay): string {
  const opts =
    Math.round(rate.bdtPerUnit * 100) % 100 === 0
      ? undefined
      : ({ minimumFractionDigits: 2, maximumFractionDigits: 4 } as const);
  return `1 ${rate.code} = ৳${rate.bdtPerUnit.toLocaleString("en-IN", opts)}`;
}
