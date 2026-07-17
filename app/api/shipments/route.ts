import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { applyHandover } from "@/lib/courier";
import { dbDate } from "@/lib/orders";
import { getSteadfastIntegration } from "@/lib/steadfast-integration";
import { createConsignmentForHandover } from "@/lib/steadfast-send";
import { SteadfastApiError } from "@/lib/steadfast";
import { STEADFAST_COURIER_NAME } from "@/lib/steadfast-constants";

// SPEC §7 — courier handover: create the shipment and move the order
// PACKED → HANDED_TO_COURIER (order status + history synced in one transaction).
// With the Steadfast courier selected, the integration enabled and no hand-typed
// tracking number, the consignment is booked via the Steadfast API on entry and
// the returned tracking code recorded (STEADFAST_INTEGRATION.md §2).
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
  // CORRECTIONS Courier §1 — zone + weight for the courier cost estimate.
  // Omitted → the order's zone and the BOM weight sum apply.
  deliveryZone: z.enum(["INSIDE_DHAKA", "SUB_DHAKA", "OUTSIDE_DHAKA"]).nullable().optional(),
  weightKg: z.number().min(0).nullable().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requirePermission("courier.manage");
    const data = bodySchema.parse(await req.json());

    const [courier, integration] = await Promise.all([
      prisma.courier.findUnique({
        where: { id: data.courierId },
        select: { name: true },
      }),
      getSteadfastIntegration(),
    ]);

    // A hand-typed tracking number means the consignment was booked outside the
    // system (e.g. in the Steadfast panel) — record it manually, no API call.
    const useSteadfastApi =
      courier?.name === STEADFAST_COURIER_NAME &&
      !!integration?.isEnabled &&
      !data.trackingNo;

    if (useSteadfastApi) {
      const result = await createConsignmentForHandover(
        {
          orderId: data.orderId,
          courierId: data.courierId,
          // @db.Date columns — UTC-midnight, not +06 instants
          handoverDate: dbDate(data.handoverDate),
          codAmount: data.codAmount,
          expectedDelivery: data.expectedDelivery ? dbDate(data.expectedDelivery) : null,
          note: data.note,
          deliveryZone: data.deliveryZone,
          weightKg: data.weightKg,
        },
        integration!,
        session.user.id
      );
      await logAudit({
        userId: session.user.id,
        action: "shipment.handover",
        entity: "shipments",
        entityId: result.shipmentId,
        after: {
          orderId: data.orderId,
          courierId: data.courierId,
          trackingNo: result.trackingCode,
          codAmount: data.codAmount,
          consignmentId: result.consignmentId,
          via: "steadfast_api",
        },
      });
      return NextResponse.json(
        {
          id: result.shipmentId,
          trackingCode: result.trackingCode,
          consignmentId: result.consignmentId,
        },
        { status: 201 }
      );
    }

    const shipment = await prisma.$transaction((tx) =>
      applyHandover(
        tx,
        {
          orderId: data.orderId,
          courierId: data.courierId,
          trackingNo: data.trackingNo,
          // @db.Date columns — UTC-midnight, not +06 instants
          handoverDate: dbDate(data.handoverDate),
          codAmount: data.codAmount,
          expectedDelivery: data.expectedDelivery ? dbDate(data.expectedDelivery) : null,
          note: data.note,
          deliveryZone: data.deliveryZone,
          weightKg: data.weightKg,
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
    // Steadfast rejected/unreachable — order stays PACKED, nothing written (§2).
    if (e instanceof SteadfastApiError) {
      return NextResponse.json({ error: `Steadfast: ${e.message}` }, { status: 502 });
    }
    return apiError(e);
  }
}
