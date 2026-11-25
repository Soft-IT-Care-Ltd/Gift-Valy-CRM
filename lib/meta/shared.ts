import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isStorefrontHost, storefrontOrigin } from "@/lib/storefront/hosts";
import type { MetaConfig } from "./config";
import type { MetaUserData } from "./user-data";

// ROUND3 W-8 — what goes to Meta (shared by ./events.ts — browsing — and
// ./orders.ts — Lead and Purchase).
//
// Browsing (PageView, ViewContent, AddToCart, InitiateCheckout): the browser
// pixel fires the event and the website sends the same event, with the same
// event_id, through the Conversions API (/api/shop/meta), so Meta counts it
// once and still gets it when the pixel is blocked. The value is priced here
// through the public catalog gate — never what the browser says.
//
// A website order: when it is PLACED the website sends Lead (it isn't a
// purchase yet — the advance hasn't been taken), browser + server, one
// event_id `<W-ref>.lead`. When the Sales Executive CONFIRMS it
// (confirmDraftTx), Purchase goes out from the server only, `<W-ref>.purchase`,
// carrying what was captured at placement (hashed phone/name/country,
// fbp/fbc, IP, browser) and the placement time, so Meta can match it to the
// ad click. Each goes out once per order (unique order + event name).
//
// Built from a whitelist: product ids are the public website addresses
// (slugs), never SKUs; never cost, the recipient, the address, the note or
// anything about another customer. user_data comes only from
// buildUserData() (./user-data.ts), which hashes the phone and name.

/** Meta accepts website events up to 7 days old; an hour's margin for retries. */
export const META_MAX_EVENT_AGE_MS = 7 * 86_400_000 - 3_600_000;

export type MetaCustomData = {
  currency?: "BDT";
  value?: number;
  content_ids?: string[];
  contents?: { id: string; quantity: number; item_price: number }[];
  content_type?: "product";
  content_name?: string;
  num_items?: number;
  order_id?: string;
};

export type MetaServerEvent = {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url: string;
  user_data: MetaUserData;
  custom_data?: MetaCustomData;
};

export type Db = Prisma.TransactionClient | typeof prisma;
export const toJson = (v: unknown) => v as Prisma.InputJsonValue;
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Only an address on our own website (path kept, query and fragment dropped); the private order link is never sent. */
export function cleanSourceUrl(raw: string | null | undefined, fallbackPath = "/"): string {
  if (raw) {
    try {
      const u = new URL(raw);
      if ((u.protocol === "https:" || u.protocol === "http:") && isStorefrontHost(u.host)) {
        const p = u.pathname.replace(/^\/order\/[^/]*.*$/, "/order").replace(/^\/preview\/.*$/, "/");
        return `${u.origin}${p}`.slice(0, 500);
      }
    } catch {
      // fall through
    }
  }
  return `${storefrontOrigin()}${fallbackPath}`;
}

export async function createEventRow(
  db: Db,
  config: MetaConfig,
  row: { eventName: string; eventId: string; eventTime: Date; orderId?: number | null; payload: MetaServerEvent; skipped?: string }
): Promise<number | null> {
  const data = {
    eventName: row.eventName,
    eventId: row.eventId,
    eventTime: row.eventTime,
    pixelId: config.pixelId,
    orderId: row.orderId ?? null,
    payload: toJson(row.payload),
    testEventCode: config.testEventCode,
    ...(row.skipped ? { status: "SKIPPED" as const, error: row.skipped } : {}),
  };
  if (!row.orderId) return (await db.metaEvent.create({ data, select: { id: true } })).id;
  // An order's event goes out once: a second attempt to queue it is a no-op.
  const { count } = await db.metaEvent.createMany({ data: [data], skipDuplicates: true });
  if (count === 0) return null;
  const made = await db.metaEvent.findUniqueOrThrow({
    where: { orderId_eventName: { orderId: row.orderId, eventName: row.eventName } },
    select: { id: true },
  });
  return made.id;
}

