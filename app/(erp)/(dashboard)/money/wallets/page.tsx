import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { serializeWallet } from "@/lib/wallet";
import { buildWalletBalances } from "@/lib/reports";
import { WalletsClient } from "@/components/money/wallets-client";

export const dynamic = "force-dynamic";

// SPEC §8 / §9.3 — company wallets (bKash/Nagad/Rocket/Bank/Cash) with per-wallet
// running balance (collections in − refunds/expenses out). Admin/Accounts/Manager.
export default async function WalletsPage() {
  await requirePagePermission("wallets.manage");

  const [wallets, balances] = await Promise.all([
    prisma.wallet.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { _count: { select: { payments: true, expenses: true } } },
    }),
    buildWalletBalances(),
  ]);

  return (
    <WalletsClient
      wallets={wallets.map(serializeWallet)}
      balances={balances}
    />
  );
}
