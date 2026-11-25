import type { WebCurrency } from "./types";

// ROUND3 W-4 — numbers on the website: English digits, the ৳ sign, lakh
// grouping (৳1,42,000). Client- and server-safe.

/** 2500 → "৳2,500"; paisa only when there are any. */
export function formatTaka(amount: number): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const whole = Math.round(value * 100) % 100 === 0;
  const text = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(Math.abs(value));
  return `${value < 0 ? "−" : ""}৳${text}`;
}

/** An option's extra price: "+৳300", "−৳100", or null for none. */
export function formatExtra(amount: number): string | null {
  if (Math.abs(amount) < 0.005) return null;
  return amount > 0 ? `+${formatTaka(amount)}` : formatTaka(amount);
}

/** "≈ SAR 120" — rounded to a whole unit (or 2 decimals under 10). Display only. */
export function formatApprox(taka: number, currency: WebCurrency): string {
  const v = taka / currency.takaPerUnit;
  const digits = v < 10 ? 2 : 0;
  const n = new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  return `≈ ${currency.iso} ${n}`;
}
