import type { CourierIntegration } from "@prisma/client";
import { prisma } from "./db";
import { AuthzError } from "./authz";
import { applyHandover } from "./courier";
import {
  createOrder,
  createBulkOrder,
  type CreateOrderPayload,
  type SteadfastCreds,
} from "./steadfast";
import { credsFromIntegration } from "./steadfast-integration";
import {
  normalizeBdPhone,
  STEADFAST_COURIER_NAME,
} from "./steadfast-constants";

// ============ Send to Steadfast (STEADFAST_INTEGRATION.md §2) ============
//
// Validate PACKED orders, create them at Steadfast (single or bulk), and on
// success record the shipment through the EXISTING applyHandover — the same code
// a manual handover uses. So the order flips PACKED → HANDED_TO_COURIER with an
// order_status_history entry and shows up in the courier reports exactly as a
// hand entry does; we then stamp the Steadfast consignment id + status onto the
// shipment. Network calls happen outside any transaction; each order's handover
// is its own transaction, so partial success in a bulk send is fine (§2).

const MAX_BULK = 500; // §5: bulk create max 500/call.

export interface SendResultRow {
  orderId: number;
  orderNo: string;
  ok: boolean;
  skipped?: boolean; // failed pre-validation (never sent)
  trackingCode?: string;
  consignmentId?: number;
  error?: string;
}

// The order fields the send flow needs.
const sendOrderSelect = {
  id: true,
  orderNo: true,
  status: true,
  recipientName: true,
  recipientPhoneBd: true,
  deliveryAddress: true,
  district: true,
  thana: true,
  occasion: true,
  requestedDeliveryDate: true,
  notes: true,
  codAmount: true,
  customer: { select: { phoneForeign: true } },
  shipment: { select: { id: true, consignmentId: true } },
  items: {
    select: {
      qty: true,
      customName: true,
      product: { select: { name: true } },
      package: { select: { name: true } },
    },
  },
} as const;

type SendOrder = Awaited<
  ReturnType<
    typeof prisma.order.findMany<{ select: typeof sendOrderSelect }>
  >
>[number];

function buildPayload(o: SendOrder, phone: string): CreateOrderPayload {
  const address = `${o.deliveryAddress}, ${o.thana}, ${o.district}`.slice(0, 250);
  const noteParts: string[] = [];
  if (o.occasion) noteParts.push(o.occasion);
  if (o.requestedDeliveryDate) {
    noteParts.push(`Deliver by ${o.requestedDeliveryDate.toISOString().slice(0, 10)}`);
  }
  if (o.notes) noteParts.push(o.notes);
  const items = o.items
    .map((it) => {
      const name = it.product?.name ?? it.package?.name ?? it.customName ?? "Item";
      return `${name} ×${it.qty}`;
    })
    .join(", ")
    .slice(0, 250);

  const altPhone = normalizeBdPhone(o.customer.phoneForeign);
  const payload: CreateOrderPayload = {
    invoice: o.orderNo,
    recipient_name: o.recipientName.slice(0, 100),
    recipient_phone: phone,
    recipient_address: address,
    cod_amount: Math.max(0, Number(o.codAmount)),
    note: noteParts.join(" · ").slice(0, 200) || undefined,
    item_description: items || undefined,
    delivery_type: 0,
    total_lot: 1,
  };
  // alternative_phone ONLY if the customer's number is itself a valid 11-digit
  // BD number (§2 mapping) — the payer is usually abroad, so this is normally omitted.
  if (altPhone) payload.alternative_phone = altPhone;
  return payload;
}

// ---------- consignment on shipment entry (manual handover form) ----------
//
// The shipments board's "Hand over" dialog with the Steadfast courier selected
// and no hand-typed tracking number books the consignment through the API and
// records the shipment with the returned tracking code — same payload rules,
// guards and handover transaction as the PACKED-tab bulk send above.

export interface HandoverConsignmentInput {
  orderId: number;
  courierId: number; // the Steadfast row in couriers — resolved by the route
  handoverDate: Date;
  codAmount: number;
  expectedDelivery: Date | null;
  note: string | null;
}

export interface HandoverConsignmentResult {
  shipmentId: number;
  consignmentId: number;
  trackingCode: string | null;
}

export async function createConsignmentForHandover(
  input: HandoverConsignmentInput,
  integration: CourierIntegration,
  userId: number
): Promise<HandoverConsignmentResult> {
  const creds: SteadfastCreds = credsFromIntegration(integration);

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: sendOrderSelect,
  });
  if (!order) throw new AuthzError(404, "Order not found");
  if (order.shipment) {
    throw new AuthzError(
      400,
      order.shipment.consignmentId
        ? "This order was already sent to Steadfast"
        : "This order already has a shipment"
    );
  }
  if (order.status !== "PACKED") {
    throw new AuthzError(
      400,
      `Only PACKED orders can be handed over — this order is ${order.status}`
    );
  }
  const phone = normalizeBdPhone(order.recipientPhoneBd);
  if (!phone) {
    throw new AuthzError(
      400,
      `Invalid recipient phone "${order.recipientPhoneBd}" — must be a 11-digit BD number`
    );
  }

  // The form's COD amount is what Steadfast collects, so it overrides the
  // order's stored cod_amount in the payload.
  const payload = buildPayload(order, phone);
  payload.cod_amount = Math.max(0, Math.round(input.codAmount * 100) / 100);

  // Network call OUTSIDE the transaction (§5), then the same handover + stamp
  // transaction the bulk send uses.
  const consignment = await createOrder(creds, payload);

  const apiNote = `Sent via Steadfast API, tracking ${
    consignment.tracking_code ?? consignment.consignment_id
  }`;
  try {
    const shipmentId = await prisma.$transaction(async (tx) => {
      const shipment = await applyHandover(
        tx,
        {
          orderId: input.orderId,
          courierId: input.courierId,
          trackingNo: consignment.tracking_code ?? null,
          handoverDate: input.handoverDate,
          codAmount: input.codAmount,
          expectedDelivery: input.expectedDelivery,
          note: input.note ? `${input.note} · ${apiNote}` : apiNote,
        },
        userId
      );
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          consignmentId: BigInt(consignment.consignment_id),
          steadfastStatus: (consignment.status ?? "in_review").toLowerCase(),
          updatedBy: userId,
        },
      });
      return shipment.id;
    });
    return {
      shipmentId,
      consignmentId: Number(consignment.consignment_id),
      trackingCode: consignment.tracking_code ?? null,
    };
  } catch (e) {
    // The consignment exists at Steadfast but recording failed — surface it so
    // the operator reconciles instead of double-booking (§2 error rule).
    throw new AuthzError(
      500,
      `Created at Steadfast (consignment ${consignment.consignment_id}) but failed to record locally: ${
        e instanceof Error ? e.message : "unknown error"
      }`
    );
  }
}

export async function sendOrdersToSteadfast(
  orderIds: number[],
  integration: CourierIntegration,
  userId: number
): Promise<SendResultRow[]> {
  const creds: SteadfastCreds = credsFromIntegration(integration);
  const results: SendResultRow[] = [];

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: sendOrderSelect,
  });
  const byId = new Map(orders.map((o) => [o.id, o]));

  // Resolve (or create) the Steadfast courier row once — applyHandover attaches
  // the shipment to it, so the manual courier reports treat these like any other.
  const courier = await prisma.courier.upsert({
    where: { name: STEADFAST_COURIER_NAME },
    update: {},
    create: { name: STEADFAST_COURIER_NAME, isActive: true, createdBy: userId },
    select: { id: true },
  });

  // ---- 1. pre-validate; collect sendable payloads (§2 guards) ----
  const toSend: { order: SendOrder; payload: CreateOrderPayload }[] = [];
  for (const orderId of orderIds) {
    const o = byId.get(orderId);
    if (!o) {
      results.push({ orderId, orderNo: String(orderId), ok: false, skipped: true, error: "Order not found" });
      continue;
    }
    if (o.shipment) {
      // Never double-send (§2 guard): an existing shipment means it's already gone.
      results.push({
        orderId,
        orderNo: o.orderNo,
        ok: false,
        skipped: true,
        error: o.shipment.consignmentId
          ? "Already sent to Steadfast"
          : "Already handed to a courier",
      });
      continue;
    }
    if (o.status !== "PACKED") {
      results.push({ orderId, orderNo: o.orderNo, ok: false, skipped: true, error: `Order is ${o.status}, not PACKED` });
      continue;
    }
    const phone = normalizeBdPhone(o.recipientPhoneBd);
    if (!phone) {
      results.push({
        orderId,
        orderNo: o.orderNo,
        ok: false,
        skipped: true,
        error: `Invalid recipient phone "${o.recipientPhoneBd}" — must be a 11-digit BD number`,
      });
      continue;
    }
    toSend.push({ order: o, payload: buildPayload(o, phone) });
  }

  if (toSend.length === 0) return results;

  // ---- 2. create at Steadfast (single or bulk, chunked at 500) ----
  // invoice → { consignmentId, trackingCode, error }
  const created = new Map<
    string,
    { consignmentId?: number; trackingCode?: string; error?: string }
  >();

  for (let i = 0; i < toSend.length; i += MAX_BULK) {
    const chunk = toSend.slice(i, i + MAX_BULK);
    if (chunk.length === 1) {
      const only = chunk[0];
      try {
        const c = await createOrder(creds, only.payload);
        created.set(only.order.orderNo, {
          consignmentId: Number(c.consignment_id),
          trackingCode: c.tracking_code,
        });
      } catch (e) {
        created.set(only.order.orderNo, {
          error: e instanceof Error ? e.message : "Steadfast create failed",
        });
      }
    } else {
      try {
        const items = await createBulkOrder(creds, chunk.map((c) => c.payload));
        const byInvoice = new Map(items.map((it) => [it.invoice, it]));
        for (const c of chunk) {
          const it = byInvoice.get(c.order.orderNo);
          if (it && it.status === "success" && it.consignment_id) {
            created.set(c.order.orderNo, {
              consignmentId: Number(it.consignment_id),
              trackingCode: it.tracking_code,
            });
          } else {
            created.set(c.order.orderNo, {
              error: it?.note || it?.status || "Steadfast rejected this order",
            });
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Steadfast bulk create failed";
        for (const c of chunk) created.set(c.order.orderNo, { error: msg });
      }
    }
  }

  // ---- 3. record each success via the EXISTING handover logic ----
  for (const { order } of toSend) {
    const res = created.get(order.orderNo);
    if (!res || res.error || !res.consignmentId) {
      results.push({
        orderId: order.id,
        orderNo: order.orderNo,
        ok: false,
        error: res?.error ?? "No consignment returned",
      });
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        const shipment = await applyHandover(
          tx,
          {
            orderId: order.id,
            courierId: courier.id,
            trackingNo: res.trackingCode ?? null,
            handoverDate: new Date(),
            codAmount: Math.max(0, Number(order.codAmount)),
            expectedDelivery: null,
            note: `Sent via Steadfast API, tracking ${res.trackingCode ?? res.consignmentId}`,
          },
          userId
        );
        await tx.shipment.update({
          where: { id: shipment.id },
          data: {
            consignmentId: BigInt(res.consignmentId!),
            steadfastStatus: "in_review",
            updatedBy: userId,
          },
        });
      });
      results.push({
        orderId: order.id,
        orderNo: order.orderNo,
        ok: true,
        trackingCode: res.trackingCode,
        consignmentId: res.consignmentId,
      });
    } catch (e) {
      // The consignment exists at Steadfast but we failed to record locally —
      // make that explicit so it can be reconciled (rare; e.g. a race).
      results.push({
        orderId: order.id,
        orderNo: order.orderNo,
        ok: false,
        error: `Created at Steadfast (consignment ${res.consignmentId}) but failed to record locally: ${
          e instanceof Error ? e.message : "unknown error"
        }`,
      });
    }
  }

  return results;
}
