import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().min(1),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("catalog.manage");
    const id = Number((await params).id);
    const data = updateSchema.parse(await req.json());

    const before = await prisma.category.findUnique({ where: { id } });
    if (!before) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }
    const after = await prisma.category.update({
      where: { id },
      data: { name: data.name.trim(), updatedBy: session.user.id },
    });
    await logAudit({
      userId: session.user.id,
      action: "category.update",
      entity: "categories",
      entityId: id,
      before,
      after,
    });
    return NextResponse.json({ ok: true });
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

export async function DELETE(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("catalog.manage");
    const id = Number((await params).id);
    const category = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }
    if (category._count.products > 0) {
      return NextResponse.json(
        { error: "Category has products — move them first" },
        { status: 400 }
      );
    }
    await prisma.category.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: "category.delete",
      entity: "categories",
      entityId: id,
      before: { id: category.id, name: category.name },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
