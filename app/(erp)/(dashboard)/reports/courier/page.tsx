import { requirePagePermission } from "@/lib/page-auth";
import { buildCourierReport } from "@/lib/reports";
import { CourierReportClient } from "@/components/reports/courier-report-client";

export const dynamic = "force-dynamic";

// R6 — Courier report (SPEC §7 / §12): pending handover, in-transit, delivered %,
// returned %, COD pending with courier (order-wise, aging). courier.manage roles.
export default async function CourierReportPage() {
  await requirePagePermission("courier.manage");
  const report = await buildCourierReport();
  return <CourierReportClient report={report} />;
}
