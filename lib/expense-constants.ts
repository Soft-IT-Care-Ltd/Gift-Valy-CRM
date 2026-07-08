// Expense constants & serializers — SPEC §9.1 / §9.2. Client-safe: only
// `import type` from Prisma, so forms, API routes and the report client share
// one source of truth without pulling server code into the client bundle
// (mirrors lib/wallet.ts).
import type { Prisma } from "@prisma/client";

export const COST_TYPES = ["FIXED", "VARIABLE"] as const;

export type CostTypeValue = (typeof COST_TYPES)[number];

export const COST_TYPE_LABELS: Record<CostTypeValue, string> = {
  FIXED: "Fixed",
  VARIABLE: "Variable",
};

// Seed categories (SPEC §9.1). Fixed/Variable follows the P&L split in §9.2:
// variable = ad, courier, packaging, MFS fees…; fixed = salary, rent, utilities…
// All are editable in the UI afterwards.
export const SEED_EXPENSE_CATEGORIES: { name: string; costType: CostTypeValue }[] = [
  { name: "Ad Cost", costType: "VARIABLE" },
  { name: "Salary", costType: "FIXED" },
  { name: "Rent", costType: "FIXED" },
  { name: "Utilities", costType: "FIXED" },
  { name: "Packaging Materials", costType: "VARIABLE" },
  { name: "Office", costType: "FIXED" },
  { name: "Reward/Bonus", costType: "VARIABLE" },
  { name: "Other", costType: "VARIABLE" },
];

// The ad-cost category name (SPEC §9.1 "Ad Cost (daily, per campaign optional)").
// Selecting it reveals the campaign field on the entry form and feeds the R8 daily
// ad-cost trend. Kept as a constant so the UI, seed and report agree on the name.
export const AD_COST_CATEGORY = "Ad Cost";

// Auto-expense sources (SPEC §6.3 / §7 / §9.1). Purchases and courier fees post
// their own expense rows linked by (ref_table, ref_id); those rows are read-only
// here and deep-link back to the owning module. `refTable === null` = a manual
// entry made on the expense screen.
export const AUTO_EXPENSE_SOURCES: Record<
  string,
  { label: string; href?: string }
> = {
  purchases: { label: "Purchase", href: "/purchases" },
  shipments: { label: "Courier", href: "/courier/shipments" },
};

export function autoExpenseSource(refTable: string | null): {
  label: string;
  href?: string;
} | null {
  if (!refTable) return null;
  return AUTO_EXPENSE_SOURCES[refTable] ?? { label: "Auto" };
}

// A category with its usage count — drives the "deactivate/keep history instead of
// delete" guard (a category with expenses on record is never hard-deleted, like
// wallets).
export type CategoryWithCounts = Prisma.ExpenseCategoryGetPayload<{
  include: { _count: { select: { expenses: true } } };
}>;

export function serializeCategory(c: CategoryWithCounts) {
  return {
    id: c.id,
    name: c.name,
    costType: c.costType as CostTypeValue,
    expenseCount: c._count.expenses,
  };
}

export type CategoryRow = ReturnType<typeof serializeCategory>;

// The minimal shape the entry form needs to pick a category.
export interface CategoryOption {
  id: number;
  name: string;
  costType: CostTypeValue;
}

// A single expense row with its category + wallet joined, for the entry list and
// the R8 detail table. Decimal → number and Date → ISO happen here so the shape
// crosses to the client safely.
export type ExpenseWithRefs = Prisma.ExpenseGetPayload<{
  include: {
    category: { select: { name: true; costType: true } };
    wallet: { select: { name: true } };
  };
}>;

export function serializeExpense(e: ExpenseWithRefs) {
  return {
    id: e.id,
    expenseDate: e.expenseDate.toISOString(),
    categoryId: e.categoryId,
    categoryName: e.category.name,
    costType: e.category.costType as CostTypeValue,
    amount: Number(e.amount),
    walletId: e.walletId,
    walletName: e.wallet?.name ?? null,
    campaignName: e.campaignName,
    notes: e.notes,
    receiptUrl: e.receiptUrl,
    // Auto-expenses (§6.3/§7) carry a ref; manual entries do not.
    refTable: e.refTable,
    refId: e.refId,
    isAuto: e.refTable !== null,
    createdAt: e.createdAt.toISOString(),
  };
}

export type ExpenseRow = ReturnType<typeof serializeExpense>;

// The include used everywhere an ExpenseRow is built — kept next to the
// serializer so query and shape never drift.
export const EXPENSE_INCLUDE = {
  category: { select: { name: true, costType: true } },
  wallet: { select: { name: true } },
} as const;
