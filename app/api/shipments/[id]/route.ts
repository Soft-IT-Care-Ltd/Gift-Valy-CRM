import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { applyShipmentStatus } from "@/lib/courier";

type Params = { params: Promise<{ id: string }> };

// SPEC §7 — shipment status update. IN_TRANSIT / DELIVERED / RETURNED drive the
// order status through the shared lifecycle; RETURNED holds the stock restore
// for Admin approval (§1.3). courierCostActual (the real amount paid to the
// courier) can be captured alongside a delivery.
const bodySchema = z.object({
  to: z.enum(["IN_TRANSIT", "DELIVERED", "RETURNED"]),
  note: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
  courierCostActual: z.number().min(0).nullable().optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("courier.manage");
    const id = Number((await params).id);
    const data = bodySchema.parse(await req.json());

    const before = await prisma.shipment.findUnique({
      where: { id },
      select: { status: true, orderId: true },
    });
    if (!before) {
      return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    }

    await prisma.$transaction((tx) =>
      applyShipmentStatus(
        tx,
        id,
        {
          to: data.to,
          note: data.note,
          courierCostActual: data.courierCostActual,
        },
        session.user.id
      )
    );

    await logAudit({
      userId: session.user.id,
      action: "shipment.status_change",
      entity: "shipments",
      entityId: id,
      before: { status: before.status },
      after: { status: data.to, note: data.note },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
