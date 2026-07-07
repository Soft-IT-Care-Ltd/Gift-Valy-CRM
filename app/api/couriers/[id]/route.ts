import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { serializeCourier } from "@/lib/courier";
import { BD_DISTRICTS } from "@/lib/order-constants";

type Params = { params: Promise<{ id: string }> };

const courierInclude = {
  zoneCharges: true,
  _count: { select: { shipments: true } },
} as const;

const zoneSchema = z.object({
  district: z.enum(BD_DISTRICTS),
  charge: z.number().min(0),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  contact: z.string().trim().nullable().optional(),
  codFeePercent: z.number().min(0).max(100).optional(),
  notes: z.string().trim().nullable().optional(),
  isActive: z.boolean().optional(),
  // When present, replaces the whole zone-charge set (like package BOM edits).
  zoneCharges: z.array(zoneSchema).optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("courier.manage");
    const id = Number((await params).id);
    const data = updateSchema.parse(await req.json());

    const before = await prisma.courier.findUnique({
      where: { id },
      include: courierInclude,
    });
    if (!before) {
      return NextResponse.json({ error: "Courier not found" }, { status: 404 });
    }
    if (data.zoneCharges) {
      const districts = data.zoneCharges.map((z) => z.district);
      if (new Set(districts).size !== districts.length) {
        throw new AuthzError(400, "Each district can appear only once per courier");
      }
    }

    const after = await prisma.$transaction(async (tx) => {
      if (data.zoneCharges) {
        await tx.courierZoneCharge.deleteMany({ where: { courierId: id } });
        if (data.zoneCharges.length > 0) {
          await tx.courierZoneCharge.createMany({
            data: data.zoneCharges.map((z) => ({
              courierId: id,
              district: z.district,
              charge: z.charge,
            })),
          });
        }
      }
      return tx.courier.update({
        where: { id },
        data: {
          name: data.name?.trim(),
          contact:
            data.contact === undefined ? undefined : data.contact?.trim() || null,
          codFeePercent: data.codFeePercent,
          notes: data.notes === undefined ? undefined : data.notes?.trim() || null,
          isActive: data.isActive,
          updatedBy: session.user.id,
        },
        include: courierInclude,
      });
    });

    await logAudit({
      userId: session.user.id,
      action: "courier.update",
      entity: "couriers",
      entityId: id,
      before: serializeCourier(before),
      after: serializeCourier(after),
    });
    return NextResponse.json({ ok: true });
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

export async function DELETE(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("courier.manage");
    const id = Number((await params).id);
    const courier = await prisma.courier.findUnique({
      where: { id },
      include: { _count: { select: { shipments: true } } },
    });
    if (!courier) {
      return NextResponse.json({ error: "Courier not found" }, { status: 404 });
    }
    if (courier._count.shipments > 0) {
      return NextResponse.json(
        {
          error:
            "Courier has shipments on record — deactivate it instead so history stays intact",
        },
        { status: 400 }
      );
    }
    await prisma.courier.delete({ where: { id } }); // cascades zone charges
    await logAudit({
      userId: session.user.id,
      action: "courier.delete",
      entity: "couriers",
      entityId: id,
      before: courier,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
