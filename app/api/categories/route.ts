import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

export async function GET() {
  try {
    await requirePermission("catalog.view");
    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true } } },
    });
    return NextResponse.json(
      categories.map((c) => ({
        id: c.id,
        name: c.name,
        productsCount: c._count.products,
      }))
    );
  } catch (e) {
    return apiError(e);
  }
}

const createSchema = z.object({
  name: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const session = await requirePermission("catalog.manage");
    const data = createSchema.parse(await req.json());
    const category = await prisma.category.create({
      data: {
        name: data.name.trim(),
        createdBy: session.user.id,
        updatedBy: session.user.id,
      },
    });
    await logAudit({
      userId: session.user.id,
      action: "category.create",
      entity: "categories",
      entityId: category.id,
      after: category,
    });
    return NextResponse.json({ id: category.id }, { status: 201 });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A category with this name already exists" },
        { status: 409 }
      );
    }
    return apiError(e);
  }
}
