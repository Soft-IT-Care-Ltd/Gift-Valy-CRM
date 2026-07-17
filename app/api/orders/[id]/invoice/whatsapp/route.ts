import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermissionCtx, apiError } from "@/lib/authz";
import { orderScopeWhere } from "@/lib/orders";
import { sendInvoiceViaWhatsApp } from "@/lib/whatsapp";

type Params = { params: Promise<{ id: string }> };

// POST /api/orders/[id]/invoice/whatsapp — manual "Send via WhatsApp" (SPEC
// §5 / §16 Phase 4). Same gate as generating an invoice, scoped so an SE can
// only send for orders they can see.
export async function POST(_req: Request, { params }: Params) {
  try {
    const { session, permissions } = await requirePermissionCtx(
      "invoice.generate"
    );
    const id = Number((await params).id);
    const scope = await orderScopeWhere(session, permissions);
    const order = await prisma.order.findFirst({
      where: { AND: [{ id }, scope] },
      select: { id: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    const message = await sendInvoiceViaWhatsApp(id, {
      trigger: "MANUAL",
      userId: session.user.id,
    });
    return NextResponse.json({
      id: message.id,
      status: message.status,
      toPhone: message.toPhone,
      createdAt: message.createdAt.toISOString(),
    });
  } catch (e) {
    return apiError(e);
  }
}
