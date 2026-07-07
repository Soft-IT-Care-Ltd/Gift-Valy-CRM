import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermissionCtx, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { generateInvoiceSafe } from "@/lib/invoice";
import {
  ORDER_PAGE_SIZE,
  buildOrderListFilters,
  createOrderSchema,
  mfsTxnRequired,
  nextOrderNo,
  orderNoPrefix,
  orderScopeWhere,
  recomputeDue,
  resolveItemsAndTotals,
  serializeOrderListRow,
} from "@/lib/orders";
import { syncReservations } from "@/lib/stock";
import { normalizePhone, type OrderStatusValue } from "@/lib/order-constants";

// Order list — same filters/window/search/pagination as the Orders page
// (shared builder in lib/orders.ts). Defaults to the current Dhaka month.
export async function GET(req: Request) {
  try {
    const { session, permissions } = await requirePermissionCtx("orders.view_own");
    const scope = await orderScopeWhere(session, permissions);
    const sp = new URL(req.url).searchParams;
    const params = Object.fromEntries(sp.entries());

    const { filters, page } = buildOrderListFilters(params, scope);
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { AND: filters },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * ORDER_PAGE_SIZE,
        take: ORDER_PAGE_SIZE,
        include: {
          customer: { select: { name: true, phoneForeign: true, country: true } },
          salesExecutive: { select: { id: true, name: true } },
        },
      }),
      prisma.order.count({ where: { AND: filters } }),
    ]);
    return NextResponse.json({
      rows: orders.map(serializeOrderListRow),
      total,
      page,
      pageSize: ORDER_PAGE_SIZE,
    });
  } catch (e) {
    return apiError(e);
  }
}

// Full order entry (§4.1 A–E): upsert customer by foreign phone, resolve items
// server-side with price-floor checks, GV-YYMM-XXXX number, advance payment
// with MFS txn-ID dedup, due/COD auto-calc, status history + audit.
export async function POST(req: Request) {
  try {
    const { session, permissions } = await requirePermissionCtx("orders.create");
    const data = createOrderSchema.parse(await req.json());
    const canOverride = permissions.includes("orders.approve_edit");

    // Section D validation
    const adv = data.advance;
    if (adv.amount > 0 && !adv.method) {
      throw new AuthzError(400, "Payment method is required for the advance");
    }
    if (adv.amount > 0 && mfsTxnRequired(adv.method) && !adv.transactionId) {
      throw new AuthzError(400, `Transaction ID is required for ${adv.method}`);
    }
    if (adv.amount > 0 && adv.transactionId) {
      const dup = await prisma.payment.findUnique({
        where: { transactionId: adv.transactionId },
        select: { order: { select: { orderNo: true } } },
      });
      if (dup) {
        throw new AuthzError(
          400,
          `Transaction ID already recorded on order ${dup.order.orderNo}`
        );
      }
    }

    // Section C: server-side resolution + floor checks (§4.1 C)
    const totals = await resolveItemsAndTotals(prisma, data.order);
    if (totals.floorBreaches.length > 0 && !canOverride) {
      throw new AuthzError(
        400,
        `Below price floor — needs TL/Admin approval: ${totals.floorBreaches.join("; ")}`
      );
    }
    if (adv.amount > totals.total) {
      throw new AuthzError(400, "Advance cannot exceed the order total");
    }
    const dueAtCreate = totals.total - adv.amount;
    const cod = data.order.codAmount ?? Math.max(dueAtCreate, 0);
    if (cod > Math.max(dueAtCreate, 0)) {
      throw new AuthzError(400, "COD amount cannot exceed the due amount");
    }

    // SPEC §1.3: no CONFIRMED without an advance > 0; TL/Admin may override
    // with a reason, otherwise the order waits at ON_HOLD.
    let initialStatus: OrderStatusValue = "CONFIRMED";
    let statusNote: string | null = null;
    if (adv.amount === 0) {
      if (canOverride && data.zeroAdvanceReason?.trim()) {
        statusNote = `Confirmed without advance (override): ${data.zeroAdvanceReason.trim()}`;
      } else {
        initialStatus = "ON_HOLD";
        statusNote = "No advance payment — held until advance is recorded";
      }
    }

    // Section E: SE = creator, team auto from SE (§4.1 E)
    const creator = await prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { teamId: true },
    });

    const phone = normalizePhone(data.customer.phoneForeign);

    // Retry on order-number collision (concurrent creates in the same month).
    let created: { id: number; orderNo: string } | null = null;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await prisma.$transaction(async (tx) => {
          // Section A: repeat customers matched by foreign phone (§4.1 A);
          // latest details win so records stay current.
          const customer = await tx.customer.upsert({
            where: { phoneForeign: phone },
            update: {
              name: data.customer.name,
              country: data.customer.country,
              fbLink: data.customer.fbLink,
              updatedBy: session.user.id,
            },
            create: {
              name: data.customer.name,
              phoneForeign: phone,
              country: data.customer.country,
              fbLink: data.customer.fbLink,
              createdBy: session.user.id,
              updatedBy: session.user.id,
            },
          });

          const orderNo = await nextOrderNo(tx, orderNoPrefix());
          const order = await tx.order.create({
            data: {
              orderNo,
              customerId: customer.id,
              recipientName: data.order.recipientName,
              recipientPhoneBd: data.order.recipientPhoneBd,
              recipientRelation: data.order.recipientRelation,
              deliveryAddress: data.order.deliveryAddress,
              district: data.order.district,
              thana: data.order.thana,
              occasion: data.order.occasion,
              requestedDeliveryDate: data.order.requestedDeliveryDate
                ? new Date(data.order.requestedDeliveryDate)
                : null,
              subtotal: totals.subtotal,
              discount: totals.discountAmount,
              courierChargeCustomer: data.order.courierCharge,
              totalAmount: totals.total,
              advanceAmount: adv.amount,
              dueAmount: totals.total, // recomputed below once payment exists
              codAmount: cod,
              status: initialStatus,
              notes: data.order.notes,
              salesExecutiveId: session.user.id,
              teamId: creator.teamId,
              createdBy: session.user.id,
              updatedBy: session.user.id,
            },
          });
          await tx.orderItem.createMany({
            data: totals.lines.map((l) => ({
              orderId: order.id,
              itemType: l.itemType,
              productId: l.productId,
              packageId: l.packageId,
              qty: l.qty,
              unitPrice: l.unitPrice,
              lineTotal: l.lineTotal,
            })),
          });
          if (adv.amount > 0) {
            await tx.payment.create({
              data: {
                orderId: order.id,
                type: "ADVANCE",
                method: adv.method!,
                amount: adv.amount,
                transactionId: adv.transactionId,
                senderNumber: adv.senderNumber,
                screenshotUrl: adv.screenshotUrl,
                createdBy: session.user.id,
                updatedBy: session.user.id,
              },
            });
          }
          await recomputeDue(tx, order.id); // integrity rule 1
          // SPEC §1.3: stock reserves at CONFIRMED (ON_HOLD reserves nothing —
          // the reservation happens when the hold lifts via the status route).
          if (initialStatus === "CONFIRMED") {
            await syncReservations(tx, order.id, session.user.id);
          }
          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              fromStatus: null,
              toStatus: initialStatus,
              byUser: session.user.id,
              note: statusNote,
            },
          });
          return { id: order.id, orderNo: order.orderNo };
        });
      } catch (err) {
        const collision =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002" &&
          (err.meta?.target as string[] | undefined)?.includes("order_no");
        if (!collision || attempt === 2) throw err;
      }
    }

    await logAudit({
      userId: session.user.id,
      action: "order.create",
      entity: "orders",
      entityId: created!.id,
      after: {
        orderNo: created!.orderNo,
        total: totals.total,
        advance: adv.amount,
        status: initialStatus,
        ...(totals.floorBreaches.length > 0
          ? { priceFloorOverride: totals.floorBreaches }
          : {}),
      },
    });
    // SPEC §5: invoice v1 auto-generated on confirmation. Non-fatal — the
    // download route regenerates on demand if this fails.
    if (initialStatus === "CONFIRMED") {
      await generateInvoiceSafe(created!.id, session.user.id);
    }
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002" &&
      (e.meta?.target as string[] | undefined)?.includes("transaction_id")
    ) {
      return NextResponse.json(
        { error: "This transaction ID is already recorded on another payment" },
        { status: 400 }
      );
    }
    return apiError(e);
  }
}
