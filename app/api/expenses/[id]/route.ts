import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { serializeExpense, EXPENSE_INCLUDE } from "@/lib/expense-constants";
import { dbDate } from "@/lib/orders";

type Params = { params: Promise<{ id: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const updateSchema = z.object({
  expenseDate: z.string().regex(DATE_RE).optional(),
  categoryId: z.number().int().positive().optional(),
  amount: z.number().positive().optional(),
  walletId: z.number().int().positive().nullable().optional(),
  campaignName: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  receiptUrl: z.string().trim().nullable().optional(),
});

// Auto-expenses (§6.3/§7) are owned by the purchase/courier module and must stay
// in sync with their source — never editable or deletable from the expense screen.
async function loadManual(id: number) {
  const expense = await prisma.expense.findUnique({
    where: { id },
    include: EXPENSE_INCLUDE,
  });
  if (!expense) return { error: "Expense not found", status: 404 as const };
  if (expense.refTable !== null) {
    return {
      error:
        "This is an auto-expense from the purchase/courier module — edit it there",
      status: 400 as const,
    };
  }
  return { expense };
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("expenses.create");
    const id = Number((await params).id);
    const data = updateSchema.parse(await req.json());

    const loaded = await loadManual(id);
    if ("error" in loaded) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }

    if (data.categoryId != null) {
      const category = await prisma.expenseCategory.findUnique({
        where: { id: data.categoryId },
        select: { id: true },
      });
      if (!category) {
        return NextResponse.json({ error: "Category not found" }, { status: 400 });
      }
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

    const after = await prisma.expense.update({
      where: { id },
      data: {
        // @db.Date — UTC-midnight, not a +06 instant
        expenseDate: data.expenseDate ? dbDate(data.expenseDate) : undefined,
        categoryId: data.categoryId,
        amount: data.amount,
        walletId: data.walletId === undefined ? undefined : data.walletId,
        campaignName:
          data.campaignName === undefined
            ? undefined
            : data.campaignName?.trim() || null,
        notes: data.notes === undefined ? undefined : data.notes?.trim() || null,
        receiptUrl:
          data.receiptUrl === undefined ? undefined : data.receiptUrl?.trim() || null,
        updatedBy: session.user.id,
      },
      include: EXPENSE_INCLUDE,
    });

    await logAudit({
      userId: session.user.id,
      action: "expense.update",
      entity: "expenses",
      entityId: id,
      before: serializeExpense(loaded.expense),
      after: serializeExpense(after),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("expenses.create");
    const id = Number((await params).id);
    const loaded = await loadManual(id);
    if ("error" in loaded) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }

    await prisma.expense.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: "expense.delete",
      entity: "expenses",
      entityId: id,
      before: serializeExpense(loaded.expense),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
