import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, requirePermissionCtx, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { canSeeCosts, serializePackage } from "@/lib/catalog";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { permissions } = await requirePermissionCtx("catalog.view");
    const id = Number((await params).id);
    const pkg = await prisma.package.findUnique({
      where: { id },
      include: { items: { include: { product: true }, orderBy: { id: "asc" } } },
    });
    if (!pkg) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }
    return NextResponse.json(serializePackage(pkg, canSeeCosts(permissions)));
  } catch (e) {
    return apiError(e);
  }
}

const itemSchema = z.object({
  productId: z.number().int(),
  qty: z.number().int().min(1),
});

const updateSchema = z
  .object({
    name: z.string().min(1).optional(),
    photoUrl: z.string().trim().nullable().optional(),
    sellingPrice: z.number().min(0).optional(),
    priceFloor: z.number().min(0).optional(),
    isActive: z.boolean().optional(),
    items: z.array(itemSchema).min(1).optional(),
  })
  .refine(
    (d) =>
      d.priceFloor === undefined ||
      d.sellingPrice === undefined ||
      d.priceFloor <= d.sellingPrice,
    { message: "Price floor cannot exceed selling price", path: ["priceFloor"] }
  )
  .refine(
    (d) =>
      d.items === undefined ||
      new Set(d.items.map((i) => i.productId)).size === d.items.length,
    { message: "Duplicate product in BOM — increase qty instead", path: ["items"] }
  );

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("catalog.manage");
    const id = Number((await params).id);
    const data = updateSchema.parse(await req.json());

    const before = await prisma.package.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!before) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }
    if (data.items) {
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
    }

    // BOM replace affects future orders only — past orders keep their
    // unit_cost_snapshot (SPEC §6.2).
    const after = await prisma.$transaction(async (tx) => {
      if (data.items) {
        await tx.packageItem.deleteMany({ where: { packageId: id } });
        await tx.packageItem.createMany({
          data: data.items.map((i) => ({ ...i, packageId: id })),
        });
      }
      return tx.package.update({
        where: { id },
        data: {
          name: data.name?.trim(),
          photoUrl: data.photoUrl === undefined ? undefined : data.photoUrl || null,
          sellingPrice: data.sellingPrice,
          priceFloor: data.priceFloor,
          isActive: data.isActive,
          updatedBy: session.user.id,
        },
        include: { items: true },
      });
    });

    await logAudit({
      userId: session.user.id,
      action: "package.update",
      entity: "packages",
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
    const pkg = await prisma.package.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!pkg) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }
    await prisma.package.delete({ where: { id } }); // items cascade
    await logAudit({
      userId: session.user.id,
      action: "package.delete",
      entity: "packages",
      entityId: id,
      before: pkg,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
