import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { serializeCategory, COST_TYPES } from "@/lib/expense-constants";

type Params = { params: Promise<{ id: string }> };

const categoryInclude = {
  _count: { select: { expenses: true } },
} as const;

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  costType: z.enum(COST_TYPES).optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("expenses.create");
    const id = Number((await params).id);
    const data = updateSchema.parse(await req.json());

    const before = await prisma.expenseCategory.findUnique({
      where: { id },
      include: categoryInclude,
    });
    if (!before) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const after = await prisma.expenseCategory.update({
      where: { id },
      data: { name: data.name?.trim(), costType: data.costType },
      include: categoryInclude,
    });

    await logAudit({
      userId: session.user.id,
      action: "expense_category.update",
      entity: "expense_categories",
      entityId: id,
      before: serializeCategory(before),
      after: serializeCategory(after),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (
      e instanceof Error &&
      "code" in e &&
      (e as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A category with this name already exists" },
        { status: 400 }
      );
    }
    return apiError(e);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("expenses.create");
    const id = Number((await params).id);
    const category = await prisma.expenseCategory.findUnique({
      where: { id },
      include: categoryInclude,
    });
    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }
    // Expense history references the category (reports, P&L split) — keep it
    // intact; block delete once anything is filed under it (matches wallets).
    if (category._count.expenses > 0) {
      return NextResponse.json(
        {
          error:
            "Category has expenses on record — reassign or keep it so the reports stay intact",
        },
        { status: 400 }
      );
    }
    await prisma.expenseCategory.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: "expense_category.delete",
      entity: "expense_categories",
      entityId: id,
      before: serializeCategory(category),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
