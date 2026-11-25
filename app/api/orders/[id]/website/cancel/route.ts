import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, AuthzError, requireUser } from "@/lib/authz";
import { getEffectivePermissions } from "@/lib/rbac";
import { orderScopeWhere, orderViewScope } from "@/lib/orders";
import { cancelWebsiteOrder } from "@/lib/website-orders";
import { WEBSITE_CANCEL_REASON_VALUES } from "@/lib/website-order-constants";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ reason: z.enum(WEBSITE_CANCEL_REASON_VALUES) }).strict();

// ROUND3 W-6 — cancel a website order still waiting for confirmation, with a
// reason (Fake order / Unreachable / Changed mind / Duplicate). The order
// must be in the person's scope; orders.cancel, or the SE it is assigned to
// (a website draft holds nothing and was never a sale). Never touches
// order_sequences: a draft has no GV number.
export async function POST(req: Request, { params }: Params) {
  try {
    const session = await requireUser();
    const permissions = await getEffectivePermissions(session.user.id);
    if (!orderViewScope(permissions)) throw new AuthzError(403, "No order view permission");
    const id = Number((await params).id);
    const { reason } = bodySchema.parse(await req.json());
    const scope = await orderScopeWhere(session, permissions);
    const order = await prisma.order.findFirst({ where: { AND: [{ id }, scope] }, select: { salesExecutiveId: true } });
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (!permissions.includes("orders.cancel") && order.salesExecutiveId !== session.user.id) {
      throw new AuthzError(403, "Only the assigned Sales Executive or someone who can cancel orders can cancel it.");
    }
    const done = await prisma.$transaction((tx) => cancelWebsiteOrder(tx, { orderId: id, reason, userId: session.user.id }));
    return NextResponse.json({ ok: true, ref: done.ref });
  } catch (e) {
    return apiError(e);
  }
}
