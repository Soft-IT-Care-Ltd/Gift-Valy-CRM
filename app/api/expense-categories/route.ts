import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { serializeCategory, COST_TYPES } from "@/lib/expense-constants";

// SPEC §9.1 — expense categories, each flagged Fixed/Variable. Managed by the
// same roles that record expenses (Accounts/Admin/Manager).
const categoryInclude = {
  _count: { select: { expenses: true } },
} as const;

const createSchema = z.object({
  name: z.string().trim().min(1, "Category name is required"),
  costType: z.enum(COST_TYPES),
});

export async function GET() {
  try {
    await requirePermission("expenses.create");
    const categories = await prisma.expenseCategory.findMany({
      orderBy: { name: "asc" },
      include: categoryInclude,
    });
    return NextResponse.json(categories.map(serializeCategory));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requirePermission("expenses.create");
    const data = createSchema.parse(await req.json());

    const category = await prisma.expenseCategory.create({
      data: { name: data.name, costType: data.costType },
      include: categoryInclude,
    });

    await logAudit({
      userId: session.user.id,
      action: "expense_category.create",
      entity: "expense_categories",
      entityId: category.id,
      after: serializeCategory(category),
    });
    return NextResponse.json({ id: category.id }, { status: 201 });
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
