import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, requirePermissionCtx, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import {
  canSeeCosts,
  packageCodeFromId,
  packageSerializeInclude,
  serializePackage,
} from "@/lib/catalog";
import {
  loadBomCatalog,
  validatePackageBomInput,
  writePackageItems,
} from "@/lib/bom-db";

export async function GET() {
  try {
    const { permissions } = await requirePermissionCtx("catalog.view");
    const [packages, catalog] = await Promise.all([
      prisma.package.findMany({
        orderBy: { name: "asc" },
        include: packageSerializeInclude,
      }),
      loadBomCatalog(prisma),
    ]);
    const showCosts = canSeeCosts(permissions);
    return NextResponse.json(
      packages.map((p) => serializePackage(p, catalog, showCosts))
    );
  } catch (e) {
    return apiError(e);
  }
}

const optionSchema = z.object({
  productId: z.number().int().positive(),
  isDefault: z.boolean().default(false),
});

// CORRECTIONS Products §5 — a BOM line is a product, a nested sub-package, or
// a choice group. Structural rules (per-kind fields, cycles, nesting cap,
// exactly one default per group) live in validatePackageBomInput.
const itemSchema = z.object({
  kind: z.enum(["PRODUCT", "PACKAGE", "CHOICE"]).default("PRODUCT"),
  productId: z.number().int().positive().nullable().optional(),
  childPackageId: z.number().int().positive().nullable().optional(),
  choiceLabel: z.string().trim().nullable().optional(),
  qty: z.number().int().min(1),
  options: z.array(optionSchema).default([]),
});

const createSchema = z
  .object({
    name: z.string().min(1),
    photoUrl: z.string().trim().nullable().optional(),
    sellingPrice: z.number().min(0),
    priceFloor: z.number().min(0).default(0),
    isActive: z.boolean().default(true),
    // CORRECTIONS Products §3 — null weight = auto-sum from the BOM explosion.
    weightKg: z.number().min(0).nullable().optional(),
    deliveryChargeInsideDhaka: z.number().min(0).default(0),
    deliveryChargeSubDhaka: z.number().min(0).default(0),
    deliveryChargeOutsideDhaka: z.number().min(0).default(0),
    items: z.array(itemSchema).min(1),
  })
  .refine((d) => d.priceFloor <= d.sellingPrice, {
    message: "Price floor cannot exceed selling price",
    path: ["priceFloor"],
  });

export async function POST(req: Request) {
  try {
    const session = await requirePermission("catalog.manage");
    const data = createSchema.parse(await req.json());

    const bomError = await validatePackageBomInput(prisma, null, data.items);
    if (bomError) {
      return NextResponse.json({ error: bomError }, { status: 400 });
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
          weightKg: data.weightKg ?? null,
          deliveryChargeInsideDhaka: data.deliveryChargeInsideDhaka,
          deliveryChargeSubDhaka: data.deliveryChargeSubDhaka,
          deliveryChargeOutsideDhaka: data.deliveryChargeOutsideDhaka,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        },
      });
      await writePackageItems(tx, created.id, data.items);
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
