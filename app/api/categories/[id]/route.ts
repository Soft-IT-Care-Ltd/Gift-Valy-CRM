import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import {
  CategoryPhotoError,
  assertCategoryPhotoUrl,
  categoryPhotoAction,
  deleteCategoryPhoto,
} from "@/lib/category-photo";

type Params = { params: Promise<{ id: string }> };

// R3-1 — photoUrl: undefined = unchanged, null = remove, a URL from
// POST /api/categories/photo = add / replace.
const updateSchema = z.object({
  name: z.string().min(1),
  photoUrl: z.string().trim().nullable().optional(),
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
    const photoUrl =
      data.photoUrl === undefined ? before.photoUrl : data.photoUrl || null;
    if (photoUrl && photoUrl !== before.photoUrl) assertCategoryPhotoUrl(photoUrl);
    let after;
    try {
      after = await prisma.category.update({
        where: { id },
        data: { name: data.name.trim(), photoUrl, updatedBy: session.user.id },
      });
    } catch (e) {
      // e.g. duplicate name — don't strand a freshly uploaded file
      if (photoUrl !== before.photoUrl) await deleteCategoryPhoto(photoUrl);
      throw e;
    }
    await logAudit({
      userId: session.user.id,
      action: "category.update",
      entity: "categories",
      entityId: id,
      before,
      after,
    });
    const photoAction = categoryPhotoAction(before.photoUrl, after.photoUrl);
    if (photoAction) {
      await logAudit({
        userId: session.user.id,
        action: photoAction,
        entity: "categories",
        entityId: id,
        before: { photoUrl: before.photoUrl },
        after: { photoUrl: after.photoUrl },
      });
      // The old file belonged to this category only (category-<uuid>.webp).
      await deleteCategoryPhoto(before.photoUrl);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof CategoryPhotoError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
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
      before: { id: category.id, name: category.name, photoUrl: category.photoUrl },
    });
    await deleteCategoryPhoto(category.photoUrl);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
