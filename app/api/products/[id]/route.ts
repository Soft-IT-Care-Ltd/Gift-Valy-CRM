import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, requirePermissionCtx, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import {
  canSeeCosts,
  productSerializeInclude,
  serializeProduct,
} from "@/lib/catalog";
import { loadBomCatalog, validateComponentRules } from "@/lib/bom-db";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { permissions } = await requirePermissionCtx("catalog.view");
    const id = Number((await params).id);
    const [product, catalog] = await Promise.all([
      prisma.product.findUnique({
        where: { id },
        include: productSerializeInclude,
      }),
      loadBomCatalog(prisma),
    ]);
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    return NextResponse.json(
      serializeProduct(product, catalog, canSeeCosts(permissions))
    );
  } catch (e) {
    return apiError(e);
  }
}

const componentSchema = z.object({
  componentId: z.number().int().positive(),
  qty: z.number().int().min(1),
});

const updateSchema = z
  .object({
    name: z.string().min(1).optional(),
    productType: z.enum(["SELLABLE", "COMPONENT"]).optional(),
    categoryId: z.number().int().optional(),
    photoUrl: z.string().trim().nullable().optional(),
    unit: z.enum(["pcs", "box", "set"]).optional(),
    avgCost: z.number().min(0).optional(),
    sellingPrice: z.number().min(0).optional(),
    priceFloor: z.number().min(0).optional(),
    lowStockThreshold: z.number().int().min(0).optional(),
    isStockTracked: z.boolean().optional(),
    isActive: z.boolean().optional(),
    weightKg: z.number().min(0).nullable().optional(),
    deliveryChargeInsideDhaka: z.number().min(0).optional(),
    deliveryChargeSubDhaka: z.number().min(0).optional(),
    deliveryChargeOutsideDhaka: z.number().min(0).optional(),
    components: z
      .array(componentSchema)
      .optional()
      .refine(
        (cs) =>
          cs === undefined ||
          new Set(cs.map((c) => c.componentId)).size === cs.length,
        { message: "Duplicate component — increase qty instead" }
      ),
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

    const before = await prisma.product.findUnique({
      where: { id },
      include: { components: true },
    });
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

    const nextType = data.productType ?? before.productType;
    const nextComponents =
      data.components ??
      before.components.map((c) => ({ componentId: c.componentId, qty: c.qty }));
    const componentError = await validateComponentRules(prisma, {
      productType: nextType,
      components: nextComponents,
      selfId: id,
    });
    if (componentError) {
      return NextResponse.json({ error: componentError }, { status: 400 });
    }
    const isComponent = nextType === "COMPONENT";
    const after = await prisma.$transaction(async (tx) => {
      if (data.components !== undefined) {
        await tx.productComponent.deleteMany({ where: { productId: id } });
        if (data.components.length > 0) {
          await tx.productComponent.createMany({
            data: data.components.map((c) => ({ ...c, productId: id })),
          });
        }
      }
      return tx.product.update({
        where: { id },
        data: {
          name: data.name?.trim(),
          productType: data.productType,
          categoryId: data.categoryId,
          photoUrl: data.photoUrl === undefined ? undefined : data.photoUrl || null,
          unit: data.unit,
          avgCost: data.avgCost,
          // §1 — component-only products carry no price.
          sellingPrice: isComponent ? 0 : data.sellingPrice,
          priceFloor: isComponent ? 0 : data.priceFloor,
          lowStockThreshold: data.lowStockThreshold,
          isStockTracked: data.isStockTracked,
          isActive: data.isActive,
          weightKg: data.weightKg === undefined ? undefined : data.weightKg,
          deliveryChargeInsideDhaka: isComponent ? 0 : data.deliveryChargeInsideDhaka,
          deliveryChargeSubDhaka: isComponent ? 0 : data.deliveryChargeSubDhaka,
          deliveryChargeOutsideDhaka: isComponent ? 0 : data.deliveryChargeOutsideDhaka,
          updatedBy: session.user.id,
        },
      });
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
      include: {
        _count: {
          select: {
            packageItems: true,
            orderItems: true,
            componentOf: true,
            choiceOptions: true,
          },
        },
      },
    });
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    if (product._count.packageItems > 0 || product._count.choiceOptions > 0) {
      return NextResponse.json(
        {
          error:
            "Product is part of a package BOM (or a choice option) — remove it from packages or deactivate it instead",
        },
        { status: 400 }
      );
    }
    if (product._count.componentOf > 0) {
      return NextResponse.json(
        {
          error:
            "Product is used as a packing material on other products — remove it there or deactivate it instead",
        },
        { status: 400 }
      );
    }
    if (product._count.orderItems > 0) {
      return NextResponse.json(
        {
          error:
            "Product appears on orders — deactivate it instead so history stays intact",
        },
        { status: 400 }
      );
    }
    await prisma.product.delete({ where: { id } }); // own components cascade
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
