import type { CurrencyRate } from "@prisma/client";
import { prisma } from "./db";
import type { CurrencyDisplay, CurrencyRateRow } from "./currency-constants";

// SPEC §5 — server-side lookups for the Admin-maintained currency rate table.

export function serializeCurrencyRate(r: CurrencyRate): CurrencyRateRow {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    symbol: r.symbol,
    bdtPerUnit: Number(r.bdtPerUnit),
    countries: r.countries,
    isActive: r.isActive,
    updatedAt: r.updatedAt.toISOString(),
  };
}

// The rate to display for a customer, matched by their free-text country
// (case-insensitive). null → no approximation shown; the invoice stays
// BDT-only, exactly as before the feature.
export async function getCurrencyForCountry(
  country: string | null | undefined
): Promise<CurrencyDisplay | null> {
  const norm = country?.trim().toLowerCase();
  if (!norm) return null;
  const rates = await prisma.currencyRate.findMany({
    where: { isActive: true },
  });
  const hit = rates.find((r) =>
    r.countries.some((c) => c.trim().toLowerCase() === norm)
  );
  if (!hit) return null;
  const bdtPerUnit = Number(hit.bdtPerUnit);
  if (!(bdtPerUnit > 0)) return null;
  return { code: hit.code, symbol: hit.symbol, bdtPerUnit };
}
