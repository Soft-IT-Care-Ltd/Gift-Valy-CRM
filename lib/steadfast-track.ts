// ============ Steadfast PUBLIC tracking page (CORRECTIONS Orders §6l) ============
//
// Server-side ONLY. Some figures (the weight Steadfast counted, rider info) are
// not in the documented V1 API — but the public tracking page shows them.
// Verified against steadfast.com.bd: the tracking SPA itself calls
// GET /tl/{token} with `Accept: application/json` and renders the returned
// { status, result: {…consignment…}, trackings: […] } — result carries weight,
// cod_amount, status, public_tracking_link, rider {name, phone} and currenthub.
// Invalid/expired links answer { status: 0, message } with HTTP 200.
//
// Be gentle (§6l): callers only fetch for shipments still missing data, cache
// via shipments.tracking_page_checked_at, and space calls out. Any failure
// (Cloudflare block, HTML instead of JSON, timeout) returns null — the UI then
// falls back to our own recorded weight with an "(ours)" marker.

const TIMEOUT_MS = 12_000;

// A plain server fetch can trip bot protection; send ordinary browser headers.
const PAGE_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "Accept-Language": "en",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

export interface PublicTrackingInfo {
  weightKg: number | null;
  codAmount: number | null;
  publicTrackingLink: string | null; // canonical link when the payload carries one
  riderName: string | null; // "Assigned To" — consumed by the In Transit work (C6)
  riderPhone: string | null;
  currentHub: string | null;
  rawStatus: string | null;
}

// The page displays weight as KG ("4.9 KG"); guard against a grams-valued
// field slipping in (no gift parcel weighs 100+ kg).
function normalizeWeightKg(value: unknown): number | null {
  const n = Number(value);
  if (value == null || value === "" || !Number.isFinite(n) || n < 0) return null;
  const kg = n > 100 ? n / 1000 : n;
  return Math.round(kg * 1000) / 1000;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function fetchPublicTracking(
  trackingUrl: string
): Promise<PublicTrackingInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(trackingUrl, {
      headers: PAGE_HEADERS,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();

    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // HTML came back — last-ditch regex for the displayed weight.
      const m = text.match(/([\d.]+)\s*KG/i);
      return m
        ? {
            weightKg: normalizeWeightKg(m[1]),
            codAmount: null,
            publicTrackingLink: null,
            riderName: null,
            riderPhone: null,
            currentHub: null,
            rawStatus: null,
          }
        : null;
    }

    const body = json as {
      status?: unknown;
      result?: Record<string, unknown> | null;
    };
    const result = body?.result;
    if (!result || typeof result !== "object") return null; // status 0 = invalid link

    const rider = result.rider as Record<string, unknown> | null | undefined;
    const hub = result.currenthub as Record<string, unknown> | null | undefined;
    return {
      weightKg: normalizeWeightKg(result.weight),
      codAmount:
        result.cod_amount != null && Number.isFinite(Number(result.cod_amount))
          ? Number(result.cod_amount)
          : null,
      publicTrackingLink: str(result.public_tracking_link),
      riderName: str(rider?.name),
      riderPhone: str(rider?.phone),
      currentHub: str(hub?.name),
      rawStatus: str(result.status),
    };
  } catch {
    return null; // network/timeout — caller treats as "no data yet"
  } finally {
    clearTimeout(timer);
  }
}
