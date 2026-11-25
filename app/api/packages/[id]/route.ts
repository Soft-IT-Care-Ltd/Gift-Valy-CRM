import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, requirePermissionCtx, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import {
  canSeeCosts,
  packageSerializeInclude,
  serializePackage,
} from "@/lib/catalog";
import {
  loadBomCatalog,
  validatePackageBomInput,
  validatePackagePrice,
  writePackageItems,
} from "@/lib/bom-db";
import { printKitInputSchema } from "@/lib/print-kit";
import { printKitColumn } from "@/lib/print-kits";
import { websiteInputSchema } from "@/lib/catalog-website-shape";
import { applyWebsite } from "@/lib/catalog-website";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  try {
    const { permissions } = await requirePermissionCtx("catalog.view");
    const id = Number((await params).id);
    const [pkg, catalog] = await Promise.all([
      prisma.package.findUnique({
        where: { id },
        include: packageSerializeInclude,
      }),
      loadBomCatalog(prisma),
    ]);
    if (!pkg) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }
    return NextResponse.json(
      serializePackage(pkg, catalog, canSeeCosts(permissions))
    );
  } catch (e) {
    return apiError(e);
  }
}

// ROUND3 R3-2 — extraPrice: ৳ per piece added to the package price when this
// option is picked (+/−; the package may never go below ৳0 — checked with
// the whole tree in validatePackageBomInput).
const optionSchema = z.object({
  productId: z.number().int().positive(),
  isDefault: z.boolean().default(false),
  extraPrice: z.number().finite().min(-9_999_999).max(9_999_999).default(0),
});

const itemSchema = z.object({
  kind: z.enum(["PRODUCT", "PACKAGE", "CHOICE"]).default("PRODUCT"),
  productId: z.number().int().positive().nullable().optional(),
  childPackageId: z.number().int().positive().nullable().optional(),
  choiceLabel: z.string().trim().nullable().optional(),
  qty: z.number().int().min(1),
  options: z.array(optionSchema).default([]),
});

const updateSchema = z
  .object({
    name: z.string().min(1).optional(),
    photoUrl: z.string().trim().nullable().optional(),
    sellingPrice: z.number().min(0).optional(),
    priceFloor: z.number().min(0).optional(),
    isActive: z.boolean().optional(),
    weightKg: z.number().min(0).nullable().optional(),
    deliveryChargeInsideDhaka: z.number().min(0).optional(),
    deliveryChargeSubDhaka: z.number().min(0).optional(),
    deliveryChargeOutsideDhaka: z.number().min(0).optional(),
    // PHOTO_PRINT PP-2 — the package's own photos / cards (null = none).
    printKit: printKitInputSchema.nullable().optional(),
    items: z.array(itemSchema).min(1).optional(),
    // ROUND3 W-2 — the Website panel (absent = unchanged).
    website: websiteInputSchema.optional(),
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

    const before = await prisma.package.findUnique({
      where: { id },
      include: { items: { include: { options: true } } },
    });
    if (!before) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }
    if (data.items) {
      // Cycle + nesting + per-kind shape validation (CORRECTIONS Products §5),
      // and no package below ৳0 with its cheapest choice extras (R3-2).
      const bomError = await validatePackageBomInput(
        prisma,
        id,
        data.items,
        data.sellingPrice ?? Number(before.sellingPrice)
      );
      if (bomError) {
        return NextResponse.json({ error: bomError }, { status: 400 });
      }
    } else if (data.sellingPrice !== undefined) {
      const priceError = await validatePackagePrice(prisma, id, data.sellingPrice);
      if (priceError) {
        return NextResponse.json({ error: priceError }, { status: 400 });
      }
    }

    // BOM replace affects future orders only — past orders keep their
    // unit_cost_snapshot (SPEC §6.2). NOTE: replacing lines re-issues
    // package_items ids, so pending (not yet packed) orders whose choice
    // selections point at old group ids fall back to the new defaults.
    const after = await prisma.$transaction(async (tx) => {
      if (data.items) {
        await writePackageItems(tx, id, data.items);
      }
      const updated = await tx.package.update({
        where: { id },
        data: {
          name: data.name?.trim(),
          photoUrl: data.photoUrl === undefined ? undefined : data.photoUrl || null,
          sellingPrice: data.sellingPrice,
          priceFloor: data.priceFloor,
          isActive: data.isActive,
          weightKg: data.weightKg === undefined ? undefined : data.weightKg,
          deliveryChargeInsideDhaka: data.deliveryChargeInsideDhaka,
          deliveryChargeSubDhaka: data.deliveryChargeSubDhaka,
          deliveryChargeOutsideDhaka: data.deliveryChargeOutsideDhaka,
          // Existing orders keep the kit frozen on them; only new kits change.
          printKit: data.printKit === undefined ? undefined : printKitColumn(data.printKit),
          updatedBy: session.user.id,
        },
      });
      await applyWebsite(tx, "package", id, data.website, {
        userId: session.user.id,
        name: updated.name,
        code: updated.code,
        price: Number(updated.sellingPrice),
        notEligible: null,
        isActive: updated.isActive,
      });
      return tx.package.findUniqueOrThrow({ where: { id }, include: { items: true } });
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
      include: {
        items: true,
        _count: { select: { orderItems: true, usedIn: true, printKits: true } },
      },
    });
    if (!pkg) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }
    // printKits: its own kit sits on an order (also when it was a sub-package there).
    if (pkg._count.orderItems > 0 || pkg._count.printKits > 0) {
      return NextResponse.json(
        {
          error:
            "Package appears on orders — deactivate it instead so history stays intact",
        },
        { status: 400 }
      );
    }
    // CORRECTIONS Products §5 — a sub-package of a combo can't just vanish.
    if (pkg._count.usedIn > 0) {
      return NextResponse.json(
        {
          error:
            "Package is a sub-package of another package — remove it from the combo first",
        },
        { status: 400 }
      );
    }
    await prisma.package.delete({ where: { id } }); // items + options cascade
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
