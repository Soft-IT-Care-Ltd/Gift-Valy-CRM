import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, requirePermissionCtx, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { canSeeCosts, serializeProduct, skuFromId } from "@/lib/catalog";

export async function GET() {
  try {
    const { permissions } = await requirePermissionCtx("catalog.view");
    const products = await prisma.product.findMany({
      orderBy: { name: "asc" },
      include: { category: true },
    });
    const showCosts = canSeeCosts(permissions);
    return NextResponse.json(products.map((p) => serializeProduct(p, showCosts)));
  } catch (e) {
    return apiError(e);
  }
}

const createSchema = z
  .object({
    name: z.string().min(1),
    categoryId: z.number().int(),
    photoUrl: z.string().trim().nullable().optional(),
    unit: z.enum(["pcs", "box", "set"]).default("pcs"),
    avgCost: z.number().min(0).default(0), // manual until purchase entry lands (Phase 2)
    sellingPrice: z.number().min(0),
    priceFloor: z.number().min(0).default(0),
    lowStockThreshold: z.number().int().min(0).default(0),
    isStockTracked: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .refine((d) => d.priceFloor <= d.sellingPrice, {
    message: "Price floor cannot exceed selling price",
    path: ["priceFloor"],
  });

export async function POST(req: Request) {
  try {
    const session = await requirePermission("catalog.manage");
    const data = createSchema.parse(await req.json());

    const category = await prisma.category.findUnique({
      where: { id: data.categoryId },
    });
    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 400 });
    }

    // SKU derives from the id, which doesn't exist until insert — create with
    // a throwaway unique placeholder, then set the real SKU in the same txn.
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          sku: `PENDING-${randomUUID()}`,
          name: data.name.trim(),
          categoryId: data.categoryId,
          photoUrl: data.photoUrl || null,
          unit: data.unit,
          avgCost: data.avgCost,
          sellingPrice: data.sellingPrice,
          priceFloor: data.priceFloor,
          lowStockThreshold: data.lowStockThreshold,
          isStockTracked: data.isStockTracked,
          isActive: data.isActive,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        },
      });
      return tx.product.update({
        where: { id: created.id },
        data: { sku: skuFromId(created.id) },
      });
    });

    await logAudit({
      userId: session.user.id,
      action: "product.create",
      entity: "products",
      entityId: product.id,
      after: product,
    });
    return NextResponse.json({ id: product.id, sku: product.sku }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
