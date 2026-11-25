import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { orderScopeWhere } from "@/lib/orders";
import { buildCustomerReport } from "@/lib/order-reports";
import { CustomerReportClient } from "@/components/reports/customer-report-client";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// R12 — Customer report (SPEC §4.1 / §12): repeat customers, top customers,
// per-country sales. Defaults to all time (repeat/top are lifetime notions).
// Role scope via orderScopeWhere — an SE sees only their own customers.
export default async function CustomerReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await requirePagePermission("orders.view_own");
  const permissions = await getEffectivePermissions(session.user.id);
  const sp = await searchParams;

  const orderWhere = await orderScopeWhere(session, permissions);

  const from =
    sp.from && DATE_RE.test(sp.from)
      ? new Date(`${sp.from}T00:00:00+06:00`)
      : undefined;
  const to =
    sp.to && DATE_RE.test(sp.to)
      ? new Date(`${sp.to}T23:59:59+06:00`)
      : undefined;

  const report = await buildCustomerReport({ from, to, orderWhere });

  return (
    <CustomerReportClient
      report={report}
      filters={{ from: sp.from ?? "", to: sp.to ?? "" }}
    />
  );
}
