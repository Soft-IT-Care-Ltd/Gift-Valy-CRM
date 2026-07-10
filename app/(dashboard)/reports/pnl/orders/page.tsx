import { requirePagePermission } from "@/lib/page-auth";
import { prisma } from "@/lib/db";
import { buildPerOrderProfitReport } from "@/lib/pnl";
import { PerOrderProfitClient } from "@/components/reports/per-order-profit-client";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// R9 per-order profit list (SPEC §9.2, Admin/Manager view) — the exact per-order
// formula for every order in range. Gated on reports.pnl.
export default async function PerOrderProfitPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; se?: string }>;
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
  const seId = sp.se && /^\d+$/.test(sp.se) ? Number(sp.se) : undefined;

  const [report, salesExecutives] = await Promise.all([
    buildPerOrderProfitReport({ from, to, seId }),
    // SEs who have created orders — the SE filter dropdown.
    prisma.user.findMany({
      where: { salesOrders: { some: {} } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <PerOrderProfitClient
      report={report}
      salesExecutives={salesExecutives}
      from={sp.from ?? ""}
      to={sp.to ?? ""}
      se={sp.se ?? ""}
    />
  );
}
