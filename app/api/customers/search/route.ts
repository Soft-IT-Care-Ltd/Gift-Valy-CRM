import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { normalizePhone } from "@/lib/order-constants";

// Repeat-customer auto-fill (§4.1 A): exact match on normalized foreign phone
// → customer fields + order history ("এই কাস্টমার আগে ৩টা অর্ডার করেছে").
// History is customer-level (no costs), so it is shown to any order creator.
export async function GET(req: Request) {
  try {
    await requirePermission("orders.create");
    const phone = normalizePhone(
      new URL(req.url).searchParams.get("phone") ?? ""
    );
    if (phone.replace(/\D/g, "").length < 6) {
      return NextResponse.json({ customer: null });
    }
    const customer = await prisma.customer.findUnique({
      where: { phoneForeign: phone },
      include: {
        orders: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            orderNo: true,
            createdAt: true,
            totalAmount: true,
            status: true,
            recipientName: true,
          },
        },
        _count: { select: { orders: true } },
      },
    });
    if (!customer) return NextResponse.json({ customer: null });
    return NextResponse.json({
      customer: {
        id: customer.id,
        name: customer.name,
        phoneForeign: customer.phoneForeign,
        country: customer.country,
        fbLink: customer.fbLink,
        orderCount: customer._count.orders,
        recentOrders: customer.orders.map((o) => ({
          id: o.id,
          orderNo: o.orderNo,
          date: o.createdAt.toISOString().slice(0, 10),
          totalAmount: Number(o.totalAmount),
          status: o.status,
          recipientName: o.recipientName,
        })),
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
