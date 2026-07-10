import { requirePagePermission } from "@/lib/page-auth";
import { buildDailySummary } from "@/lib/pnl";
import { DailySummaryClient } from "@/components/reports/daily-summary-client";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// R9 daily summary (SPEC §9.3) — date-wise sales, collection, costs, net.
// Gated on reports.pnl (Admin/Accounts by seed; Manager if granted) — a
// costing view, never reachable by Sales/TeamLeader/Packing (CLAUDE.md rule 1).
export default async function DailySummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requirePagePermission("reports.pnl");
  const sp = await searchParams;

  const from =
    sp.from && DATE_RE.test(sp.from)
      ? new Date(`${sp.from}T00:00:00+06:00`)
      : undefined;
  const to =
    sp.to && DATE_RE.test(sp.to)
      ? new Date(`${sp.to}T23:59:59+06:00`)
      : undefined;

  const summary = await buildDailySummary({ from, to });
  return (
    <DailySummaryClient
      summary={summary}
      from={sp.from ?? ""}
      to={sp.to ?? ""}
    />
  );
}
