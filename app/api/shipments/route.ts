import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { applyHandover } from "@/lib/courier";

// SPEC §7 — courier handover: create the shipment and move the order
// PACKED → HANDED_TO_COURIER (order status + history synced in one transaction).
const bodySchema = z.object({
  orderId: z.number().int().positive(),
  courierId: z.number().int().positive(),
  trackingNo: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
  handoverDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  codAmount: z.number().min(0),
  expectedDelivery: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  note: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
});

export async function POST(req: Request) {
  try {
    const session = await requirePermission("courier.manage");
    const data = bodySchema.parse(await req.json());

    const shipment = await prisma.$transaction((tx) =>
      applyHandover(
        tx,
        {
          orderId: data.orderId,
          courierId: data.courierId,
          trackingNo: data.trackingNo,
          handoverDate: new Date(`${data.handoverDate}T00:00:00+06:00`),
          codAmount: data.codAmount,
          expectedDelivery: data.expectedDelivery
            ? new Date(`${data.expectedDelivery}T00:00:00+06:00`)
            : null,
          note: data.note,
        },
        session.user.id
      )
    );

    await logAudit({
      userId: session.user.id,
      action: "shipment.handover",
      entity: "shipments",
      entityId: shipment.id,
      after: {
        orderId: data.orderId,
        courierId: data.courierId,
        trackingNo: data.trackingNo,
        codAmount: data.codAmount,
      },
    });
    return NextResponse.json({ id: shipment.id }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
