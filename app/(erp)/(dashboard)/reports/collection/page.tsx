import { requirePagePermission } from "@/lib/page-auth";
import { buildCollectionReport } from "@/lib/reports";
import { CollectionReportClient } from "@/components/reports/collection-report-client";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// R7 — Collection report (SPEC §8 / §12): total collected, by method, by wallet,
// verified vs unverified, and total dues outstanding with order-wise aging.
// payments.verify roles (Accounts, Manager, Admin).
export default async function CollectionReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requirePagePermission("payments.verify");
  const sp = await searchParams;

  const from =
    sp.from && DATE_RE.test(sp.from)
      ? new Date(`${sp.from}T00:00:00+06:00`)
      : undefined;
  const to =
    sp.to && DATE_RE.test(sp.to)
      ? new Date(`${sp.to}T23:59:59+06:00`)
      : undefined;

  const report = await buildCollectionReport({ from, to });
  return (
    <CollectionReportClient
      report={report}
      from={sp.from ?? ""}
      to={sp.to ?? ""}
    />
  );
}
