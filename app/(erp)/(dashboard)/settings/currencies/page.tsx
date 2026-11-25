import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { serializeCurrencyRate } from "@/lib/currency";
import { CurrencyRatesClient } from "@/components/settings/currency-rates-client";

export const dynamic = "force-dynamic";

// Settings → Currency rates (SPEC §5 — customer-currency display on invoices).
// Admin-only (settings.manage).
export default async function CurrencyRatesPage() {
  await requirePagePermission("settings.manage");
  const rates = await prisma.currencyRate.findMany({ orderBy: { code: "asc" } });
  return <CurrencyRatesClient initial={rates.map(serializeCurrencyRate)} />;
}
