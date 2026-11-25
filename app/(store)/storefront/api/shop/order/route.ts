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
export const dynamic = "force-dynamic";

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
  try {
    const placed = await placeWebsiteOrder(body, { ip: clientIp(request.headers) });
    return publicJson({ ref: placed.ref, link: `/order/${placed.token}` }, 201);
  } catch (error) {
    if (error instanceof WebsiteOrderError) {
      return publicJson({ error: error.message, field: error.field, fields: error.fields }, error.status);
    }
    console.error("Website order failed:", error);
    return publicJson({ error: copy.api.serverError }, 500);
  }
}
