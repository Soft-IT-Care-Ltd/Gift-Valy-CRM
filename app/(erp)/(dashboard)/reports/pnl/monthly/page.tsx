import { requirePagePermission } from "@/lib/page-auth";
import { buildMonthlyPnl } from "@/lib/pnl";
import { REVENUE_BASES, type RevenueBasis } from "@/lib/pnl-constants";
import { MonthlyPnlClient } from "@/components/reports/monthly-pnl-client";

export const dynamic = "force-dynamic";

const YM_RE = /^\d{4}-\d{2}$/;

// R9 monthly P&L (SPEC §9.2) — revenue − COGS − variable − fixed = net, with
// margins and a vs-previous-month comparison. Gated on reports.pnl.
export default async function MonthlyPnlPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; basis?: string }>;
}) {
  await requirePagePermission("reports.pnl");
  const sp = await searchParams;

  const ym = sp.ym && YM_RE.test(sp.ym) ? sp.ym : undefined;
  const basis: RevenueBasis =
    sp.basis && (REVENUE_BASES as readonly string[]).includes(sp.basis)
      ? (sp.basis as RevenueBasis)
      : "confirmed";

  const pnl = await buildMonthlyPnl({ ym, basis });
  return <MonthlyPnlClient pnl={pnl} />;
}
