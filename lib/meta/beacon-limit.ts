// ROUND3 W-8 — a flood guard for the pixel beacon (/api/shop/meta): at most
// this many events per visitor address per minute (a real shopper sends a
// handful). In memory — the website runs as one process per copy
// (deploy/ecosystem*.config.cjs). Pure: no Next imports.

export const BEACON_PER_MINUTE = 60;
const WINDOW_MS = 60_000;
const MAX_TRACKED = 20_000;

const hits = new Map<string, { start: number; count: number }>();

export function allowBeacon(ip: string | null, now = Date.now()): boolean {
  const key = ip ?? "-";
  const h = hits.get(key);
  if (!h || now - h.start >= WINDOW_MS) {
    if (hits.size >= MAX_TRACKED) hits.clear();
    hits.set(key, { start: now, count: 1 });
    return true;
  }
  h.count += 1;
  return h.count <= BEACON_PER_MINUTE;
}

export function resetBeaconLimit(): void {
  hits.clear();
}

/** Crawlers and link-preview bots never count as visitors. */
export const isBotUserAgent = (ua: string | null | undefined): boolean =>
  !ua || /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview|headless|lighthouse|pingdom|curl|wget|python|node-fetch/i.test(ua);
