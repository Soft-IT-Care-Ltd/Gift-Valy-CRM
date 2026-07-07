import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { serializeCourier } from "@/lib/courier";
import { BD_DISTRICTS } from "@/lib/order-constants";

// SPEC §7 — courier companies with a COD fee % and per-district zone charges.
const zoneSchema = z.object({
  district: z.enum(BD_DISTRICTS),
  charge: z.number().min(0),
});

const courierInclude = {
  zoneCharges: true,
  _count: { select: { shipments: true } },
} as const;

const createSchema = z.object({
  name: z.string().trim().min(1, "Courier name is required"),
  contact: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
  codFeePercent: z.number().min(0).max(100).default(0),
  notes: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
  isActive: z.boolean().default(true),
  zoneCharges: z.array(zoneSchema).default([]),
});

export async function GET() {
  try {
    await requirePermission("courier.manage");
    const couriers = await prisma.courier.findMany({
      orderBy: { name: "asc" },
      include: courierInclude,
    });
    return NextResponse.json(couriers.map(serializeCourier));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requirePermission("courier.manage");
    const data = createSchema.parse(await req.json());

    // Zone districts must be unique within one courier (one charge per district).
    const districts = data.zoneCharges.map((z) => z.district);
    if (new Set(districts).size !== districts.length) {
      throw new AuthzError(400, "Each district can appear only once per courier");
    }

    const courier = await prisma.courier.create({
      data: {
        name: data.name,
        contact: data.contact,
        codFeePercent: data.codFeePercent,
        notes: data.notes,
        isActive: data.isActive,
        createdBy: session.user.id,
        updatedBy: session.user.id,
        zoneCharges: {
          create: data.zoneCharges.map((z) => ({
            district: z.district,
            charge: z.charge,
          })),
        },
      },
      include: courierInclude,
    });

    await logAudit({
      userId: session.user.id,
      action: "courier.create",
      entity: "couriers",
      entityId: courier.id,
      after: serializeCourier(courier),
    });
    return NextResponse.json({ id: courier.id }, { status: 201 });
  } catch (e) {
    if (
      e instanceof Error &&
      "code" in e &&
      (e as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A courier with this name already exists" },
        { status: 400 }
      );
    }
    return apiError(e);
  }
}
