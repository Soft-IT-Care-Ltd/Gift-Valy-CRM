// ROUND3 W-5 — the front door of the website's public endpoints (/api/shop/*):
// the website's own pages may call them, other sites may not; the body is
// read only up to a small limit; every answer is no-store. Pure (no Next or
// Node imports) so the tests drive it with plain Requests.

export const ORDER_BODY_LIMIT = 16_384;
export const BAG_BODY_LIMIT = 8_192;

export function publicJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * A request another site's page sent → 403. Browsers say so in
 * Sec-Fetch-Site; an Origin header that isn't this host is refused too.
 */
export function rejectCrossSite(request: Request, message = "Not allowed"): Response | null {
  if (request.headers.get("sec-fetch-site") === "cross-site") return publicJson({ error: message }, 403);
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return publicJson({ error: message }, 403);
    }
    if (originHost !== (request.headers.get("host") ?? "").toLowerCase()) return publicJson({ error: message }, 403);
  }
  return null;
}

/**
 * JSON only → else 415. A form on another site can post text/plain or a
 * form encoding without asking first; it can't post application/json.
 */
export function rejectNonJson(request: Request, message = "JSON only"): Response | null {
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return type === "application/json" ? null : publicJson({ error: message }, 415);
}

export class BodyTooLargeError extends Error {}

/** The JSON body, at most `maxBytes` (declared or actual); null when it isn't JSON. */
export async function readJsonLimited(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
