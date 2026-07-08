import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { AuthzError } from "./authz";
import { dhakaDayStart } from "./orders";
import { ensurePurchaseExpenseCategory, purchasePaymentStatus } from "./stock";

// ============ SPEC §6.3 — supplier credit (purchase dues) ============
//
// A purchase receives goods immediately (stock + weighted-avg cost) but its cost
// hits the books only as cash is paid. Each payment toward a purchase is a
// "Product Purchase" Expense row linked by ref (refTable="purchases", refId), so
// it flows into the R8 expense report on the pay date and into the wallet balance
// (lib/reports.ts buildWalletBalances subtracts expenses by wallet). Amount paid
// is therefore just Σ of those expenses; due = total − paid; no separate table.

type Tx = Prisma.TransactionClient | PrismaClient;

const round2 = (n: number) => Math.round(n * 100) / 100;

// Cash paid so far toward a purchase = Σ linked "Product Purchase" expenses.
export async function purchasePaidAmount(
  tx: Tx,
  purchaseId: number
): Promise<number> {
  const agg = await tx.expense.aggregate({
    where: { refTable: "purchases", refId: purchaseId },
    _sum: { amount: true },
  });
  return round2(Number(agg._sum.amount ?? 0));
}

export interface PurchasePaymentInput {
  purchaseId: number;
  amount: number;
  walletId: number | null;
  paymentDate: Date;
  notes?: string | null;
}

// Record a payment against a purchase's outstanding balance (from the due list).
// Posts one expense on paymentDate from walletId, then refreshes the cached
// paymentStatus. Rejects over-payment so paid can never exceed the bill.
export async function recordPurchasePayment(
  tx: Prisma.TransactionClient,
  input: PurchasePaymentInput,
  userId: number
) {
  const purchase = await tx.purchase.findUnique({
    where: { id: input.purchaseId },
    select: { id: true, supplierName: true, totalAmount: true, paymentStatus: true },
  });
  if (!purchase) throw new AuthzError(404, "Purchase not found");

  const total = Number(purchase.totalAmount);
  const paid = await purchasePaidAmount(tx, purchase.id);
  const due = round2(total - paid);
  if (due <= 0) throw new AuthzError(400, "This purchase is already fully paid");

  const amount = round2(input.amount);
  if (amount <= 0) throw new AuthzError(400, "Payment amount must be greater than 0");
  if (amount > due) {
    throw new AuthzError(
      400,
      `Payment ৳${amount} exceeds the outstanding due of ৳${due}`
    );
  }

  const categoryId = await ensurePurchaseExpenseCategory(tx);
  const expense = await tx.expense.create({
    data: {
      expenseDate: input.paymentDate,
      categoryId,
      amount,
      walletId: input.walletId,
      notes: input.notes?.trim()
        ? `Due payment — ${purchase.supplierName} — ${input.notes.trim()}`
        : `Due payment — ${purchase.supplierName}`,
      refTable: "purchases",
      refId: purchase.id,
      createdBy: userId,
      updatedBy: userId,
    },
  });

  const newPaid = round2(paid + amount);
  const status = purchasePaymentStatus(total, newPaid);
  await tx.purchase.update({
    where: { id: purchase.id },
    // Clear the due date once the bill is settled; keep it while a balance remains.
    data: {
      paymentStatus: status,
      dueDate: status === "PAID" ? null : undefined,
      updatedBy: userId,
    },
  });

  return { expenseId: expense.id, paid: newPaid, due: round2(total - newPaid), status };
}

// ---------- due list (SPEC §6.3 — outstanding supplier bills) ----------

export interface PurchaseDueRow {
  id: number;
  supplierName: string;
  purchaseDate: string; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD
  total: number;
  paid: number;
  due: number;
  itemsSummary: string;
  overdue: boolean;
  ageDays: number; // days past the due date (0 when not overdue / no date)
}

export interface PurchaseDues {
  rows: PurchaseDueRow[];
  totalOutstanding: number;
  overdueCount: number;
  overdueTotal: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Every purchase with an unpaid balance, overdue-first then by due date. Paid
// amounts come from one expense groupBy over all outstanding purchases. Accepts
// a tx client (defaults to prisma) so verification can run it inside a rolled-back
// transaction.
export async function buildPurchaseDues(db: Tx = prisma): Promise<PurchaseDues> {
  const purchases = await db.purchase.findMany({
    where: { paymentStatus: { not: "PAID" } },
    include: {
      items: { include: { product: { select: { name: true } } } },
    },
  });
  if (purchases.length === 0) {
    return { rows: [], totalOutstanding: 0, overdueCount: 0, overdueTotal: 0 };
  }

  const paidAgg = await db.expense.groupBy({
    by: ["refId"],
    where: { refTable: "purchases", refId: { in: purchases.map((p) => p.id) } },
    _sum: { amount: true },
  });
  const paidById = new Map(
    paidAgg.map((r) => [r.refId!, round2(Number(r._sum.amount ?? 0))])
  );

  const todayStart = dhakaDayStart().getTime();

  const rows: PurchaseDueRow[] = purchases.map((p) => {
    const total = Number(p.totalAmount);
    const paid = paidById.get(p.id) ?? 0;
    const due = round2(total - paid);
    const dueTime = p.dueDate ? p.dueDate.getTime() : null;
    const overdue = dueTime != null && dueTime < todayStart;
    return {
      id: p.id,
      supplierName: p.supplierName,
      purchaseDate: p.purchaseDate.toISOString().slice(0, 10),
      dueDate: p.dueDate ? p.dueDate.toISOString().slice(0, 10) : null,
      total,
      paid,
      due,
      itemsSummary: p.items
        .map((it) => `${it.qty} × ${it.product.name}`)
        .join(", "),
      overdue,
      ageDays: overdue ? Math.floor((todayStart - dueTime!) / DAY_MS) : 0,
    };
  });

  // Overdue first, then soonest due date (undated last), then largest due.
  rows.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate)
      return a.dueDate < b.dueDate ? -1 : 1;
    if (!!a.dueDate !== !!b.dueDate) return a.dueDate ? -1 : 1;
    return b.due - a.due;
  });

  const overdueRows = rows.filter((r) => r.overdue);
  return {
    rows,
    totalOutstanding: round2(rows.reduce((s, r) => s + r.due, 0)),
    overdueCount: overdueRows.length,
    overdueTotal: round2(overdueRows.reduce((s, r) => s + r.due, 0)),
  };
}
