import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, requirePermissionCtx, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import {
  canSeeCosts,
  productSerializeInclude,
  serializeProduct,
  skuFromId,
} from "@/lib/catalog";
import { loadBomCatalog, validateComponentRules } from "@/lib/bom-db";

export async function GET() {
  try {
    const { permissions } = await requirePermissionCtx("catalog.view");
    const [products, catalog] = await Promise.all([
      prisma.product.findMany({
        orderBy: { name: "asc" },
        include: productSerializeInclude,
      }),
      loadBomCatalog(prisma),
    ]);
    const showCosts = canSeeCosts(permissions);
    return NextResponse.json(
      products.map((p) => serializeProduct(p, catalog, showCosts))
    );
  } catch (e) {
    return apiError(e);
  }
}

const componentSchema = z.object({
  componentId: z.number().int().positive(),
  qty: z.number().int().min(1),
});

const createSchema = z
  .object({
    name: z.string().min(1),
    productType: z.enum(["SELLABLE", "COMPONENT"]).default("SELLABLE"),
    categoryId: z.number().int(),
    photoUrl: z.string().trim().nullable().optional(),
    unit: z.enum(["pcs", "box", "set"]).default("pcs"),
    avgCost: z.number().min(0).default(0), // manual until purchase entry lands (Phase 2)
    sellingPrice: z.number().min(0).default(0),
    priceFloor: z.number().min(0).default(0),
    lowStockThreshold: z.number().int().min(0).default(0),
    isStockTracked: z.boolean().default(true),
    isActive: z.boolean().default(true),
    // CORRECTIONS Products §2/§3
    weightKg: z.number().min(0).nullable().optional(),
    deliveryChargeInsideDhaka: z.number().min(0).default(0),
    deliveryChargeSubDhaka: z.number().min(0).default(0),
    deliveryChargeOutsideDhaka: z.number().min(0).default(0),
    components: z.array(componentSchema).default([]),
  })
  .refine((d) => d.priceFloor <= d.sellingPrice, {
    message: "Price floor cannot exceed selling price",
    path: ["priceFloor"],
  })
  .refine(
    (d) =>
      new Set(d.components.map((c) => c.componentId)).size ===
      d.components.length,
    { message: "Duplicate component — increase qty instead", path: ["components"] }
  );

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
    const componentError = await validateComponentRules(prisma, data);
    if (componentError) {
      return NextResponse.json({ error: componentError }, { status: 400 });
    }

    const isComponent = data.productType === "COMPONENT";

    // SKU derives from the id, which doesn't exist until insert — create with
    // a throwaway unique placeholder, then set the real SKU in the same txn.
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          sku: `PENDING-${randomUUID()}`,
          name: data.name.trim(),
          productType: data.productType,
          categoryId: data.categoryId,
          photoUrl: data.photoUrl || null,
          unit: data.unit,
          avgCost: data.avgCost,
          // §1 — component-only products have no selling price.
          sellingPrice: isComponent ? 0 : data.sellingPrice,
          priceFloor: isComponent ? 0 : data.priceFloor,
          lowStockThreshold: data.lowStockThreshold,
          isStockTracked: data.isStockTracked,
          isActive: data.isActive,
          weightKg: data.weightKg ?? null,
          deliveryChargeInsideDhaka: isComponent ? 0 : data.deliveryChargeInsideDhaka,
          deliveryChargeSubDhaka: isComponent ? 0 : data.deliveryChargeSubDhaka,
          deliveryChargeOutsideDhaka: isComponent ? 0 : data.deliveryChargeOutsideDhaka,
          createdBy: session.user.id,
          updatedBy: session.user.id,
          components: {
            createMany: {
              data: data.components.map((c) => ({
                componentId: c.componentId,
                qty: c.qty,
              })),
            },
          },
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
