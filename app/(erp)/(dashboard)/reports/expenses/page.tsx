import { requirePagePermission } from "@/lib/page-auth";
import { buildExpenseReport } from "@/lib/reports";
import { ExpenseReportClient } from "@/components/reports/expense-report-client";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// R8 — Expense report (SPEC §9.1 / §12): by category, fixed vs variable split,
// and the ad-cost daily trend. Gated on expenses.create (Admin/Accounts/Manager).
export default async function ExpenseReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requirePagePermission("expenses.create");
  const sp = await searchParams;

  const from =
    sp.from && DATE_RE.test(sp.from)
      ? new Date(`${sp.from}T00:00:00+06:00`)
      : undefined;
  const to =
    sp.to && DATE_RE.test(sp.to)
      ? new Date(`${sp.to}T23:59:59+06:00`)
      : undefined;

  const report = await buildExpenseReport({ from, to });
  return (
    <ExpenseReportClient report={report} from={sp.from ?? ""} to={sp.to ?? ""} />
  );
}
