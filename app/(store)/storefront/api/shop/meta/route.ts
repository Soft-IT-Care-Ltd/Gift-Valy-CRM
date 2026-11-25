import { z } from "zod";
import { allowBeacon, isBotUserAgent } from "@/lib/meta/beacon-limit";
import { BROWSE_EVENTS, queueBrowseEvent } from "@/lib/meta/events";
import { flushMetaEvents, sendSoon } from "@/lib/meta/send";
import { clientIp } from "@/lib/storefront/client-ip";
import { BodyTooLargeError, readJsonLimited, rejectCrossSite } from "@/lib/storefront/http";

// ROUND3 W-8 — the server copy of a browser pixel event (PageView,
// ViewContent, AddToCart, InitiateCheckout), sent through the Conversions API
// with the browser's event_id so Meta counts it once. Same-site only, a tiny
// Zod-checked body, bots and floods dropped; prices are read from the database
// through the catalog gate, never from the browser. Always 204 — it says
// nothing back. Nothing is queued while tracking is off (lib/meta/config.ts).
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9-]{1,80}$/;
const bodySchema = z.object({
  event: z.enum(BROWSE_EVENTS),
  eventId: z.string().regex(/^[A-Za-z0-9_.-]{8,80}$/),
  url: z.string().max(1000).nullish(),
  product: z.string().regex(SLUG).nullish(),
  items: z
    .array(
      z.object({
        kind: z.enum(["product", "package"]),
        slug: z.string().regex(SLUG),
        picks: z.record(z.string().max(12), z.number().int().nonnegative()).refine((p) => Object.keys(p).length <= 30),
        qty: z.number().int().min(1).max(50),
      })
    )
    .max(30)
    .nullish(),
});

const done = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

const cookie = (request: Request, name: string): string | null => {
  const raw = request.headers.get("cookie") ?? "";
  const hit = raw.split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
};

export async function POST(request: Request) {
  if (rejectCrossSite(request)) return done();
  if (/prefetch|prerender/i.test(`${request.headers.get("sec-purpose") ?? ""} ${request.headers.get("purpose") ?? ""}`)) return done();
  const userAgent = request.headers.get("user-agent");
  if (isBotUserAgent(userAgent)) return done();
  const ip = clientIp(request.headers);
  if (!allowBeacon(ip)) return done();
  let body: unknown;
  try {
    body = await readJsonLimited(request, 4096);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return done();
    throw e;
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return done();
  const b = parsed.data;
  try {
    const id = await queueBrowseEvent(undefined, {
      event: b.event,
      eventId: b.eventId,
      url: b.url ?? request.headers.get("referer"),
      product: b.product,
      items: b.items ?? undefined,
      ip,
      userAgent,
      fbp: cookie(request, "_fbp"),
      fbc: cookie(request, "_fbc"),
    });
    if (id) sendSoon(() => flushMetaEvents(undefined, { ids: [id] }));
  } catch (e) {
    console.error("Meta tracking: browse event not queued —", e);
  }
  return done();
}
