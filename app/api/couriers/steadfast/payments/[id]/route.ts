import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { serializeSteadfastPayment } from "@/lib/steadfast-payments";

type Params = { params: Promise<{ id: string }> };

// CORRECTIONS Orders §R8 — one payment invoice with its consignment breakdown
// (the Courier page's expandable detail view). Matched rows deep-link the
// order; unmatched rows are the flagged-for-review list. courier.manage.
export async function GET(_req: Request, { params }: Params) {
  try {
    await requirePermission("courier.manage");
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new AuthzError(400, "Invalid payment id");
    }

    const payment = await prisma.steadfastPayment.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            order: { select: { id: true, orderNo: true, status: true } },
            shipment: { select: { codAmount: true } },
          },
          orderBy: { id: "asc" },
        },
      },
    });
    if (!payment) throw new AuthzError(404, "Payment not found");

    return NextResponse.json(serializeSteadfastPayment(payment));
  } catch (e) {
    return apiError(e);
  }
}
