import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, requirePermissionCtx, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { canSeeCosts, packageCodeFromId, serializePackage } from "@/lib/catalog";

export async function GET() {
  try {
    const { permissions } = await requirePermissionCtx("catalog.view");
    const packages = await prisma.package.findMany({
      orderBy: { name: "asc" },
      include: { items: { include: { product: true }, orderBy: { id: "asc" } } },
    });
    const showCosts = canSeeCosts(permissions);
    return NextResponse.json(packages.map((p) => serializePackage(p, showCosts)));
  } catch (e) {
    return apiError(e);
  }
}

const itemSchema = z.object({
  productId: z.number().int(),
  qty: z.number().int().min(1),
});

const createSchema = z
  .object({
    name: z.string().min(1),
    photoUrl: z.string().trim().nullable().optional(),
    sellingPrice: z.number().min(0),
    priceFloor: z.number().min(0).default(0),
    isActive: z.boolean().default(true),
    items: z.array(itemSchema).min(1),
  })
  .refine((d) => d.priceFloor <= d.sellingPrice, {
    message: "Price floor cannot exceed selling price",
    path: ["priceFloor"],
  })
  .refine(
    (d) => new Set(d.items.map((i) => i.productId)).size === d.items.length,
    { message: "Duplicate product in BOM — increase qty instead", path: ["items"] }
  );

export async function POST(req: Request) {
  try {
    const session = await requirePermission("catalog.manage");
    const data = createSchema.parse(await req.json());

    const productIds = data.items.map((i) => i.productId);
    const found = await prisma.product.count({
      where: { id: { in: productIds } },
    });
    if (found !== productIds.length) {
      return NextResponse.json(
        { error: "One or more BOM products do not exist" },
        { status: 400 }
      );
    }

    // Code derives from the id — placeholder insert, then real code, same txn.
    const pkg = await prisma.$transaction(async (tx) => {
      const created = await tx.package.create({
        data: {
          code: `PENDING-${randomUUID()}`,
          name: data.name.trim(),
          photoUrl: data.photoUrl || null,
          sellingPrice: data.sellingPrice,
          priceFloor: data.priceFloor,
          isActive: data.isActive,
          createdBy: session.user.id,
          updatedBy: session.user.id,
          items: { createMany: { data: data.items } },
        },
      });
      return tx.package.update({
        where: { id: created.id },
        data: { code: packageCodeFromId(created.id) },
        include: { items: true },
      });
    });

    await logAudit({
      userId: session.user.id,
      action: "package.create",
      entity: "packages",
      entityId: pkg.id,
      after: pkg,
    });
    return NextResponse.json({ id: pkg.id, code: pkg.code }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
