import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermissionCtx, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { orderScopeWhere } from "@/lib/orders";

type Params = { params: Promise<{ id: string }> };

const trimmedOrNull = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : null));

const bodySchema = z.object({
  notes: trimmedOrNull, // Order Note (internal)
  invoiceNote: trimmedOrNull, // printed on the invoice
  courierNote: trimmedOrNull, // Steadfast consignment note
});

// CORRECTIONS Orders §6d — the order list's Note modal updates the 3 notes
// without opening the full edit flow. Notes are operational annotations, not
// money/stock data, so the gate is: orders.edit holders, or the order's own SE.
// The invoice is NOT regenerated here — the invoice note prints on the next
// generation (download regenerates on demand only when missing), keeping this
// a lightweight write.
export async function PATCH(req: Request, { params }: Params) {
  try {
    const { session, permissions } = await requirePermissionCtx("orders.view_own");
    const id = Number((await params).id);
    const data = bodySchema.parse(await req.json());

    const scope = await orderScopeWhere(session, permissions);
    const order = await prisma.order.findFirst({
      where: { AND: [{ id }, scope] },
      select: {
        id: true,
        orderNo: true,
        salesExecutiveId: true,
        notes: true,
        invoiceNote: true,
        courierNote: true,
      },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    const allowed =
      permissions.includes("orders.edit") ||
      order.salesExecutiveId === session.user.id;
    if (!allowed) {
      throw new AuthzError(403, "Not allowed to update this order's notes");
    }

    await prisma.order.update({
      where: { id },
      data: {
        notes: data.notes,
        invoiceNote: data.invoiceNote,
        courierNote: data.courierNote,
        updatedBy: session.user.id,
      },
    });
    await logAudit({
      userId: session.user.id,
      action: "order.notes_update",
      entity: "orders",
      entityId: id,
      before: {
        notes: order.notes,
        invoiceNote: order.invoiceNote,
        courierNote: order.courierNote,
      },
      after: data,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
