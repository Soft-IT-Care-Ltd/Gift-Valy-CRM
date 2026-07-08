import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { serializeCategory } from "@/lib/expense-constants";
import { ExpenseCategoriesClient } from "@/components/money/expense-categories-client";

export const dynamic = "force-dynamic";

// SPEC §9.1 — expense categories, each flagged Fixed/Variable. Admin/Accounts/Manager.
export default async function ExpenseCategoriesPage() {
  await requirePagePermission("expenses.create");

  const categories = await prisma.expenseCategory.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { expenses: true } } },
  });

  return <ExpenseCategoriesClient categories={categories.map(serializeCategory)} />;
}
