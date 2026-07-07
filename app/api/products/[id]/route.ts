import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, requirePermissionCtx, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { canSeeCosts, serializeProduct } from "@/lib/catalog";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { permissions } = await requirePermissionCtx("catalog.view");
    const id = Number((await params).id);
    const product = await prisma.product.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    return NextResponse.json(serializeProduct(product, canSeeCosts(permissions)));
  } catch (e) {
    return apiError(e);
  }
}

const updateSchema = z
  .object({
    name: z.string().min(1).optional(),
    categoryId: z.number().int().optional(),
    photoUrl: z.string().trim().nullable().optional(),
    unit: z.enum(["pcs", "box", "set"]).optional(),
    avgCost: z.number().min(0).optional(),
    sellingPrice: z.number().min(0).optional(),
    priceFloor: z.number().min(0).optional(),
    lowStockThreshold: z.number().int().min(0).optional(),
    isStockTracked: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.priceFloor === undefined ||
      d.sellingPrice === undefined ||
      d.priceFloor <= d.sellingPrice,
    { message: "Price floor cannot exceed selling price", path: ["priceFloor"] }
  );

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("catalog.manage");
    const id = Number((await params).id);
    const data = updateSchema.parse(await req.json());

    const before = await prisma.product.findUnique({ where: { id } });
    if (!before) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    if (data.categoryId !== undefined) {
      const category = await prisma.category.findUnique({
        where: { id: data.categoryId },
      });
      if (!category) {
        return NextResponse.json({ error: "Category not found" }, { status: 400 });
      }
    }
    const after = await prisma.product.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        categoryId: data.categoryId,
        photoUrl: data.photoUrl === undefined ? undefined : data.photoUrl || null,
        unit: data.unit,
        avgCost: data.avgCost,
        sellingPrice: data.sellingPrice,
        priceFloor: data.priceFloor,
        lowStockThreshold: data.lowStockThreshold,
        isStockTracked: data.isStockTracked,
        isActive: data.isActive,
        updatedBy: session.user.id,
      },
    });
    await logAudit({
      userId: session.user.id,
      action: "product.update",
      entity: "products",
      entityId: id,
      before,
      after,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("catalog.manage");
    const id = Number((await params).id);
    const product = await prisma.product.findUnique({
      where: { id },
      include: { _count: { select: { packageItems: true } } },
    });
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    if (product._count.packageItems > 0) {
      return NextResponse.json(
        {
          error:
            "Product is part of a package BOM — remove it from packages or deactivate it instead",
        },
        { status: 400 }
      );
    }
    await prisma.product.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: "product.delete",
      entity: "products",
      entityId: id,
      before: product,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
