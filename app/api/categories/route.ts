import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import {
  CategoryPhotoError,
  assertCategoryPhotoUrl,
  deleteCategoryPhoto,
} from "@/lib/category-photo";

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
        photoUrl: c.photoUrl,
        productsCount: c._count.products,
      }))
    );
  } catch (e) {
    return apiError(e);
  }
}

// R3-1 — photoUrl: a URL from POST /api/categories/photo, or null (no photo).
const createSchema = z.object({
  name: z.string().min(1),
  photoUrl: z.string().trim().nullable().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requirePermission("catalog.manage");
    const data = createSchema.parse(await req.json());
    const photoUrl = data.photoUrl || null;
    if (photoUrl) assertCategoryPhotoUrl(photoUrl);
    let category;
    try {
      category = await prisma.category.create({
        data: {
          name: data.name.trim(),
          photoUrl,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        },
      });
    } catch (e) {
      await deleteCategoryPhoto(photoUrl); // e.g. duplicate name — don't strand the file
      throw e;
    }
    await logAudit({
      userId: session.user.id,
      action: "category.create",
      entity: "categories",
      entityId: category.id,
      after: category,
    });
    if (photoUrl) {
      await logAudit({
        userId: session.user.id,
        action: "category.photo.add",
        entity: "categories",
        entityId: category.id,
        after: { photoUrl },
      });
    }
    return NextResponse.json({ id: category.id }, { status: 201 });
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
