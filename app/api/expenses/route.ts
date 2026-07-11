import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { serializeExpense, EXPENSE_INCLUDE } from "@/lib/expense-constants";
import { dbDate } from "@/lib/orders";

// SPEC §9.1 — quick daily expense entry (Accounts/Admin). Auto-expenses (from
// purchase §6.3 / courier §7) are created by those modules, not here.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  // YYYY-MM-DD → interpreted at Asia/Dhaka midnight (expense_date is a DATE).
  expenseDate: z.string().regex(DATE_RE, "Pick a valid date"),
  categoryId: z.number().int().positive(),
  amount: z.number().positive("Amount must be greater than zero"),
  walletId: z.number().int().positive().nullable().optional(),
  campaignName: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  notes: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  receiptUrl: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function POST(req: Request) {
  try {
    const session = await requirePermission("expenses.create");
    const data = createSchema.parse(await req.json());

    // Validate FKs up front so we return clean 400s instead of a Prisma error.
    const category = await prisma.expenseCategory.findUnique({
      where: { id: data.categoryId },
      select: { id: true },
    });
    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 400 });
    }
    if (data.walletId != null) {
      const wallet = await prisma.wallet.findUnique({
        where: { id: data.walletId },
        select: { id: true },
      });
      if (!wallet) {
        return NextResponse.json({ error: "Wallet not found" }, { status: 400 });
      }
    }

    const expense = await prisma.expense.create({
      data: {
        expenseDate: dbDate(data.expenseDate), // @db.Date — UTC-midnight, not a +06 instant
        categoryId: data.categoryId,
        amount: data.amount,
        walletId: data.walletId ?? null,
        campaignName: data.campaignName,
        notes: data.notes,
        receiptUrl: data.receiptUrl,
        createdBy: session.user.id,
        updatedBy: session.user.id,
      },
      include: EXPENSE_INCLUDE,
    });

    await logAudit({
      userId: session.user.id,
      action: "expense.create",
      entity: "expenses",
      entityId: expense.id,
      after: serializeExpense(expense),
    });
    return NextResponse.json({ id: expense.id }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
