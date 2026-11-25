import { prisma } from "@/lib/db";
import { getWebItem, webBagLines, type Db as GateDb } from "@/lib/storefront/catalog";
import { getMetaConfig } from "./config";
import { cleanSourceUrl, createEventRow, round2, type Db, type MetaCustomData } from "./shared";
import { buildUserData } from "./user-data";

// ROUND3 W-8 — browsing events (PageView, ViewContent, AddToCart,
// InitiateCheckout): the server copy of what the browser pixel fired, with
// its event_id, priced here through the public catalog gate — never what the
// browser says. No phone, no name: only Meta's cookies, the IP and the browser.

export const BROWSE_EVENTS = ["PageView", "ViewContent", "AddToCart", "InitiateCheckout"] as const;
export type BrowseEvent = (typeof BROWSE_EVENTS)[number];

const gate = (db: Db) => db as unknown as GateDb;

export type BrowseItem = { kind: "product" | "package"; slug: string; picks: Record<string, number>; qty: number };

export type BrowseInput = {
  event: BrowseEvent;
  eventId: string;
  url: string | null;
  /** ViewContent: the item on screen. */
  product?: string | null;
  /** AddToCart / InitiateCheckout: the line(s), with their picks. */
  items?: BrowseItem[];
  ip: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | null;
  now?: Date;
};

/** Products, quantities and today's prices for the lines (the gate's packagePrice()); null = nothing on the website. */
async function linesCustomData(db: Db, items: BrowseItem[]): Promise<MetaCustomData | null> {
  const live = await webBagLines(items.map(({ kind, slug, picks }) => ({ kind, slug, picks })), gate(db));
  const bySlug = new Map<string, { quantity: number; value: number }>();
  live.forEach((line, i) => {
    if (!line) return;
    const row = bySlug.get(line.slug) ?? { quantity: 0, value: 0 };
    row.quantity += items[i].qty;
    row.value += items[i].qty * line.price;
    bySlug.set(line.slug, row);
  });
  if (bySlug.size === 0) return null;
  const contents = [...bySlug].map(([id, r]) => ({ id, quantity: r.quantity, item_price: round2(r.value / r.quantity) }));
  return {
    currency: "BDT",
    value: round2(contents.reduce((s, c) => s + c.item_price * c.quantity, 0)),
    content_ids: contents.map((c) => c.id),
    contents,
    content_type: "product",
    num_items: contents.reduce((s, c) => s + c.quantity, 0),
  };
}

async function browseCustomData(db: Db, input: BrowseInput): Promise<MetaCustomData | null | undefined> {
  if (input.event === "PageView") return undefined;
  if (input.event === "ViewContent") {
    if (!input.product) return null;
    const found = await getWebItem(input.product, gate(db));
    if (!found || !("item" in found)) return null;
    const item = found.item;
    return { currency: "BDT", value: round2(item.price), content_ids: [item.slug], content_type: "product", content_name: item.name.slice(0, 120) };
  }
  const items = (input.items ?? []).filter((i) => i.qty > 0);
  if (items.length === 0) return null;
  return linesCustomData(db, items);
}

/** The server copy of a browser event. The queued row's id, or null when nothing was queued (tracking off, not on the website). */
export async function queueBrowseEvent(db: Db = prisma, input: BrowseInput): Promise<number | null> {
  const config = await getMetaConfig(db);
  if (!config) return null;
  const now = input.now ?? new Date();
  const customData = await browseCustomData(db, input);
  if (customData === null) return null;
  return createEventRow(db, config, {
    eventName: input.event,
    eventId: input.eventId,
    eventTime: now,
    payload: {
      event_name: input.event,
      event_time: Math.floor(now.getTime() / 1000),
      event_id: input.eventId,
      action_source: "website",
      event_source_url: cleanSourceUrl(input.url),
      // Browsing carries no phone and no name — only Meta's cookies, the IP and the browser.
      user_data: buildUserData({ fbp: input.fbp, fbc: input.fbc, ip: input.ip, userAgent: input.userAgent }),
      ...(customData ? { custom_data: customData } : {}),
    },
  });
}

