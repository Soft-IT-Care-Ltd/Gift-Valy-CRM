import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { dhakaMonthStart, dhakaDayStart } from "@/lib/orders";
import {
  serializeExpense,
  EXPENSE_INCLUDE,
  type CategoryOption,
} from "@/lib/expense-constants";
import type { WalletOption } from "@/lib/wallet";
import { ExpenseEntryClient } from "@/components/money/expense-entry-client";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

// SPEC §9.1 / §9.3 — quick daily expense entry (<1 min) plus this month's ledger,
// including the read-only auto-expenses from purchase (§6.3) and courier (§7).
export default async function ExpensesPage() {
  await requirePagePermission("expenses.create");

  const monthStart = dhakaMonthStart();
  const monthEnd = new Date(dhakaDayStart().getTime() + DAY_MS - 1);

  const [categories, wallets, expenses] = await Promise.all([
    prisma.expenseCategory.findMany({ orderBy: { name: "asc" } }),
    prisma.wallet.findMany({
      where: { isActive: true },
      orderBy: [{ name: "asc" }],
    }),
    prisma.expense.findMany({
      where: { expenseDate: { gte: monthStart, lte: monthEnd } },
      include: EXPENSE_INCLUDE,
      orderBy: [{ expenseDate: "desc" }, { id: "desc" }],
    }),
  ]);

  const categoryOptions: CategoryOption[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    costType: c.costType,
  }));
  const walletOptions: WalletOption[] = wallets.map((w) => ({
    id: w.id,
    name: w.name,
    type: w.type,
  }));

  return (
    <ExpenseEntryClient
      categories={categoryOptions}
      wallets={walletOptions}
      expenses={expenses.map(serializeExpense)}
      monthLabel={monthStart.toISOString()}
    />
  );
}
