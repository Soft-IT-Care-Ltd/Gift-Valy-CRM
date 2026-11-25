import { queueOrderLead } from "@/lib/meta/orders";
import { flushMetaEvents, sendSoon } from "@/lib/meta/send";
import { clientIp } from "@/lib/storefront/client-ip";
import { copy } from "@/lib/storefront/copy";
import {
  BodyTooLargeError,
  ORDER_BODY_LIMIT,
  publicJson,
  readJsonLimited,
  rejectCrossSite,
  rejectNonJson,
} from "@/lib/storefront/http";
import { placeWebsiteOrder, WebsiteOrderError } from "@/lib/storefront/place-order";

// ROUND3 W-5 — POST /api/shop/order, the website's ONE public write: place an
// order. Same-site only, JSON only, a small body, Zod-checked, limited per
// WhatsApp number and per IP, honeypot-checked, and every price worked out
// on the server (lib/storefront/place-order.ts). The order is a DRAFT; it
// answers with the reference and the private confirmation link — nothing
// else about the order, the customer or the shop. Never cached.
//
// W-8: once the order has committed, Meta's Lead is queued (never in the
// order's way — lib/meta/orders.ts) and sent after the response; `track`
// tells the checkout which event to fire in the browser with the same
// event_id (null while tracking is off). It holds the pixel id, the event
// id, the order's value, its item addresses and quantities — never a name,
// phone or address.
export const dynamic = "force-dynamic";

const cookie = (request: Request, name: string): string | null => {
  const hit = (request.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
};

export async function POST(request: Request) {
  const refused = rejectCrossSite(request, copy.api.crossSite) ?? rejectNonJson(request, copy.api.notJson);
  if (refused) return refused;
  let body: unknown;
  try {
    body = await readJsonLimited(request, ORDER_BODY_LIMIT);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return publicJson({ error: copy.api.tooLarge }, 413);
    throw error;
  }
  const ip = clientIp(request.headers);
  try {
    const placed = await placeWebsiteOrder(body, { ip });
    const meta = await queueOrderLead(undefined, {
      orderId: placed.orderId,
      ip,
      userAgent: request.headers.get("user-agent"),
      fbp: cookie(request, "_fbp"),
      fbc: cookie(request, "_fbc"),
      sourceUrl: request.headers.get("referer"),
    });
    if (meta?.eventRowId) {
      const id = meta.eventRowId;
      sendSoon(() => flushMetaEvents(undefined, { ids: [id] }));
    }
    return publicJson({ ref: placed.ref, link: `/order/${placed.token}`, track: meta?.browser ?? null }, 201);
  } catch (error) {
    if (error instanceof WebsiteOrderError) {
      return publicJson({ error: error.message, field: error.field, fields: error.fields }, error.status);
    }
    console.error("Website order failed:", error);
    return publicJson({ error: copy.api.serverError }, 500);
  }
}
