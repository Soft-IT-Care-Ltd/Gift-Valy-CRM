import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { buildCodPending } from "@/lib/courier";
import { CodReconcileClient } from "@/components/courier/cod-reconcile-client";

export const dynamic = "force-dynamic";

function dhakaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
}

// SPEC §7 — COD reconciliation for Accounts: delivered shipments whose COD the
// courier still owes. Marking them received records the COD payment (settling
// due) and auto-posts the courier's COD fee as an expense. The received COD can
// be attributed to the wallet the courier remitted into (SPEC §8).
export default async function CodReconcilePage() {
  await requirePagePermission("courier.manage");
  const [rows, wallets] = await Promise.all([
    buildCodPending(),
    prisma.wallet.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
  ]);
  return <CodReconcileClient rows={rows} today={dhakaToday()} wallets={wallets} />;
}
