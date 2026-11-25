import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { WebContact } from "@/lib/website-order-constants";
import { getMetaConfig } from "./config";
import { cleanSourceUrl, createEventRow, META_MAX_EVENT_AGE_MS, round2, toJson, type Db, type MetaCustomData } from "./shared";
import { buildUserData, type MetaUserData } from "./user-data";

// ROUND3 W-8 — a website order's events: Lead when it is placed (browser +
// server, `<W-ref>.lead`), Purchase when the Sales Executive confirms it
// (server only, `<W-ref>.purchase`, with what was captured at placement and
// the placement time). Each at most once per order. Kept apart from the
// browsing events so confirmDraftTx (lib/orders.ts) doesn't load the
// website's catalog gate.

/** What the checkout fires in the browser right after placing (same event_id as the server's Lead). */
export type BrowserOrderEvent = { pixelId: string; event: "Lead"; eventId: string; data: MetaCustomData };

export const orderEventId = (ref: string, kind: "lead" | "purchase") => `${ref}.${kind}`;

const ORDER_SELECT = {
  id: true,
  source: true,
  webRef: true,
  totalAmount: true,
  createdAt: true,
  customerId: true,
  webContact: true,
  items: { select: { qty: true, lineTotal: true, product: { select: { slug: true } }, package: { select: { slug: true } } } },
} satisfies Prisma.OrderSelect;
type OrderForMeta = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

/** Products, quantities and the order total in taka, from the order as saved. Nothing else about the order. */
export function orderCustomData(o: Pick<OrderForMeta, "webRef" | "totalAmount" | "items">): MetaCustomData {
  const bySlug = new Map<string, { quantity: number; value: number }>();
  for (const i of o.items) {
    const id = i.product?.slug ?? i.package?.slug;
    if (!id) continue;
    const row = bySlug.get(id) ?? { quantity: 0, value: 0 };
    row.quantity += i.qty;
    row.value += Number(i.lineTotal);
    bySlug.set(id, row);
  }
  const contents = [...bySlug].map(([id, r]) => ({ id, quantity: r.quantity, item_price: round2(r.value / r.quantity) }));
  return {
    currency: "BDT",
    value: round2(Number(o.totalAmount)),
    content_ids: contents.map((c) => c.id),
    contents,
    content_type: "product",
    num_items: contents.reduce((s, c) => s + c.quantity, 0),
    order_id: o.webRef ?? undefined,
  };
}

/**
 * A website order was just placed (its transaction has committed): capture
 * what Meta needs to match it later, queue Lead, and say what the browser
 * should fire with the same event_id. Null while tracking is off. Never
 * throws — tracking must never get in an order's way.
 */
export async function queueOrderLead(
  db: Db = prisma,
  input: { orderId: number; ip: string | null; userAgent: string | null; fbp: string | null; fbc: string | null; sourceUrl: string | null }
): Promise<{ eventRowId: number | null; browser: BrowserOrderEvent } | null> {
  try {
    const config = await getMetaConfig(db);
    if (!config) return null;
    const order = await db.order.findUnique({ where: { id: input.orderId }, select: ORDER_SELECT });
    if (!order || order.source !== "WEBSITE" || !order.webRef) return null;
    const sender = (order.webContact as unknown as WebContact | null)?.sender;
    const userData = buildUserData({
      phone: sender?.whatsapp,
      name: sender?.name,
      country: sender?.country,
      customerId: order.customerId,
      fbp: input.fbp,
      fbc: input.fbc,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    const eventSourceUrl = cleanSourceUrl(input.sourceUrl, "/checkout");
    await db.metaOrderSignal.upsert({
      where: { orderId: order.id },
      create: { orderId: order.id, userData: toJson(userData), eventSourceUrl, placedAt: order.createdAt },
      update: {},
    });
    const eventId = orderEventId(order.webRef, "lead");
    const data = orderCustomData(order);
    const eventRowId = await createEventRow(db, config, {
      eventName: "Lead",
      eventId,
      eventTime: order.createdAt,
      orderId: order.id,
      payload: {
        event_name: "Lead",
        event_time: Math.floor(order.createdAt.getTime() / 1000),
        event_id: eventId,
        action_source: "website",
        event_source_url: eventSourceUrl,
        user_data: userData,
        custom_data: data,
      },
    });
    return { eventRowId, browser: { pixelId: config.pixelId, event: "Lead", eventId, data } };
  } catch (e) {
    console.error("Meta tracking: Lead not queued —", e);
    return null;
  }
}

/**
 * The SE confirmed a draft (confirmDraftTx). Queues its Purchase behind a
 * savepoint: if anything here fails, the confirmation goes ahead without it
 * (the meta-events job sweeps it up). A staff order (no placement capture)
 * is a no-op.
 */
export async function queuePurchaseOnConfirm(tx: Prisma.TransactionClient, orderId: number, now = new Date()): Promise<void> {
  await tx.$executeRawUnsafe("SAVEPOINT meta_purchase");
  try {
    await queuePurchase(tx, orderId, now);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT meta_purchase");
  } catch (e) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT meta_purchase");
    console.error("Meta tracking: Purchase not queued at confirmation —", e);
  }
}

/** Queue the Purchase for a confirmed website order (once; nothing without a placement capture or with tracking off). */
export async function queuePurchase(db: Db, orderId: number, now = new Date()): Promise<"queued" | "exists" | "too_old" | "no_signal" | "off"> {
  const signal = await db.metaOrderSignal.findUnique({ where: { orderId } });
  if (!signal) return "no_signal";
  const existing = await db.metaEvent.findUnique({ where: { orderId_eventName: { orderId, eventName: "Purchase" } }, select: { id: true } });
  if (existing) return "exists";
  const config = await getMetaConfig(db);
  if (!config) return "off";
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: ORDER_SELECT });
  if (!order.webRef) return "no_signal";
  const eventId = orderEventId(order.webRef, "purchase");
  const tooOld = now.getTime() - signal.placedAt.getTime() > META_MAX_EVENT_AGE_MS;
  await createEventRow(db, config, {
    eventName: "Purchase",
    eventId,
    eventTime: signal.placedAt,
    orderId,
    payload: {
      event_name: "Purchase",
      event_time: Math.floor(signal.placedAt.getTime() / 1000),
      event_id: eventId,
      action_source: "website",
      event_source_url: signal.eventSourceUrl,
      user_data: signal.userData as MetaUserData,
      custom_data: orderCustomData(order),
    },
    ...(tooOld ? { skipped: "Confirmed more than 7 days after it was placed — Meta doesn't accept events that old" } : {}),
  });
  return tooOld ? "too_old" : "queued";
}
