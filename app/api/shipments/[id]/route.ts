import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, apiError, AuthzError } from "@/lib/authz";
import { getEffectivePermissions } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { applyShipmentStatus } from "@/lib/courier";

type Params = { params: Promise<{ id: string }> };

// SPEC §7 — shipment status update. IN_TRANSIT / DELIVERED / RETURNED drive the
// order status through the shared lifecycle; RETURNED holds the stock restore
// for the return-receive inspection (CORRECTIONS §6n). courierCostActual (the
// real amount paid to the courier) can be captured alongside a delivery.
//
// CORRECTIONS Orders §R5 — `manualOverride` marks an Admin correcting a status by
// hand (when Steadfast is wrong). It requires the dedicated orders.courier_override
// permission (Admin-only by default) instead of courier.manage, and stamps the
// order history "Manual override by <admin>" so the correction is auditable. The
// normal side effects (stock, COD reconciliation queue, history) fire either way
// because both paths run through applyShipmentStatus.
const bodySchema = z.object({
  to: z.enum(["IN_TRANSIT", "DELIVERED", "RETURNED"]),
  note: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
  courierCostActual: z.number().min(0).nullable().optional(),
  manualOverride: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requireUser();
    const permissions = await getEffectivePermissions(session.user.id);
    const id = Number((await params).id);
    const data = bodySchema.parse(await req.json());

    // A hand correction needs the override permission; a routine courier update
    // needs courier.manage. Admin holds both.
    const requiredPermission = data.manualOverride
      ? "orders.courier_override"
      : "courier.manage";
    if (!permissions.includes(requiredPermission)) {
      throw new AuthzError(403, `Missing permission: ${requiredPermission}`);
    }

    const before = await prisma.shipment.findUnique({
      where: { id },
      select: { status: true, orderId: true },
    });
    if (!before) {
      return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    }

    // §R5 — record WHO overrode, in the note that lands on order_status_history.
    let note = data.note;
    if (data.manualOverride) {
      const actor = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { name: true },
      });
      const who = actor?.name ?? `user #${session.user.id}`;
      note = `Manual override by ${who}${data.note ? ` — ${data.note}` : ""}`;
    }

    await prisma.$transaction((tx) =>
      applyShipmentStatus(
        tx,
        id,
        {
          to: data.to,
          note,
          courierCostActual: data.courierCostActual,
        },
        session.user.id
      )
    );

    await logAudit({
      userId: session.user.id,
      action: data.manualOverride
        ? "shipment.status_override"
        : "shipment.status_change",
      entity: "shipments",
      entityId: id,
      before: { status: before.status },
      after: { status: data.to, note, manualOverride: !!data.manualOverride },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
