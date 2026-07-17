import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { applyReturnReceive, buildReturnInspection } from "@/lib/courier";

type Params = { params: Promise<{ id: string }> };

// CORRECTIONS Orders §6n — the Packaging team receives a returned parcel back
// at the warehouse. GET serves the inspection sheet (every BOM-exploded item
// the ledger says is out); POST applies the inspection: OK units → IN_RETURN
// stock, damaged units → damage log + "Damaged Stock" P&L loss. This receive
// action REPLACES the old Admin return approval, so it is gated on orders.pack
// (the Packaging role) — no separate approval permission.

export async function GET(_req: Request, { params }: Params) {
  try {
    await requirePermission("orders.pack");
    const id = Number((await params).id);
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        returnReceivedAt: true,
        order: { select: { id: true, orderNo: true } },
      },
    });
    if (!shipment) {
      return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    }
    if (shipment.status !== "RETURNED") {
      return NextResponse.json(
        { error: "Only a returned shipment can be inspected" },
        { status: 400 }
      );
    }
    if (shipment.returnReceivedAt != null) {
      return NextResponse.json(
        { error: "This return is already received" },
        { status: 400 }
      );
    }
    const items = await buildReturnInspection(prisma, shipment.order.id);
    return NextResponse.json({
      shipmentId: shipment.id,
      orderNo: shipment.order.orderNo,
      // No cost fields here on purpose — the inspector (Packing) is cost-blind.
      items,
    });
  } catch (e) {
    return apiError(e);
  }
}

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        damagedQty: z.number().int().min(0),
      })
    )
    .default([]),
  note: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
  returnCharge: z.number().min(0).optional(),
});

export async function POST(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("orders.pack");
    const id = Number((await params).id);
    const data = bodySchema.parse(await req.json());

    const result = await prisma.$transaction((tx) =>
      applyReturnReceive(
        tx,
        id,
        { items: data.items, note: data.note, returnCharge: data.returnCharge },
        session.user.id
      )
    );

    // §6n — fully audit-logged: who received, what was marked damaged.
    await logAudit({
      userId: session.user.id,
      action: "shipment.return_receive",
      entity: "shipments",
      entityId: id,
      after: {
        damaged: data.items.filter((i) => i.damagedQty > 0),
        restoredQty: result.restoredQty,
        damagedQty: result.damagedQty,
        note: data.note,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return apiError(e);
  }
}
