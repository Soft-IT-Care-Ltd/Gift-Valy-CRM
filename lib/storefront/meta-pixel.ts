// ROUND3 W-8 — the Meta Pixel in the browser. Every event is fired here AND
// sent to our server (/api/shop/meta), which sends the same event, with the
// same event_id, through the Conversions API — Meta counts the pair once, and
// still gets it when the pixel is blocked. The server prices it from the
// database; what the browser says about money is only the pixel's own copy.
//
// Loaded only while tracking is on (Settings → Website → Meta Pixel): the
// layout says which pixel, or null. The pixel is initialised with its ID
// ONLY — no advanced matching, so the browser never hands Meta a phone, a
// name or an e-mail (the server sends those hashed, for an order only:
// lib/meta/user-data.ts). Automatic events and history-change PageViews are
// off: only these events go out. Browser-only (imported by client components).

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...a: unknown[]) => void;
  queue: unknown[];
  loaded: boolean;
  version: string;
  push: Fbq;
  disablePushState?: boolean;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

/** The custom data a browser event may carry — never anything about the person. */
export type PixelData = {
  currency?: "BDT";
  value?: number;
  content_ids?: string[];
  content_type?: "product";
  content_name?: string;
  num_items?: number;
  contents?: { id: string; quantity: number; item_price?: number }[];
  order_id?: string;
};

export type BrowseEventName = "PageView" | "ViewContent" | "AddToCart" | "InitiateCheckout";
export type BrowseServerBody = {
  product?: string;
  items?: { kind: "product" | "package"; slug: string; picks: Record<string, number>; qty: number }[];
};

/** The pixel from Settings: undefined until the layout has said (events wait), null = tracking off. */
let pixel: string | null | undefined;
let waiting: (() => void)[] = [];
let initialised = false;

function loadBase(pixelId: string) {
  if (!window.fbq) {
    const n = function (...args: unknown[]) {
      if (n.callMethod) n.callMethod(...args);
      else n.queue.push(args);
    } as Fbq;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    // No automatic PageView when the address changes: we send our own, with an event_id.
    n.disablePushState = true;
    window.fbq = n;
    window._fbq = n;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }
  if (!initialised) {
    initialised = true;
    window.fbq!("set", "autoConfig", false, pixelId);
    window.fbq!("init", pixelId);
  }
}

/** Set once by the website's layout: the pixel, or null while tracking is off. */
export function setPixel(pixelId: string | null) {
  pixel = pixelId;
  const run = waiting;
  waiting = [];
  for (const fn of run) fn();
}

function whenReady(fn: () => void) {
  if (pixel === undefined) waiting.push(fn);
  else fn();
}

/** A random event id (iOS 14 has getRandomValues, not randomUUID). */
function newEventId(event: string): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return `${event.toLowerCase()}.${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("")}`;
}

function beacon(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  try {
    if (navigator.sendBeacon?.("/api/shop/meta", new Blob([json], { type: "application/json" }))) return;
  } catch {
    // fall through to fetch
  }
  fetch("/api/shop/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: json, keepalive: true }).catch(() => {});
}

/** PageView / ViewContent / AddToCart / InitiateCheckout — browser and server, one event_id. */
export function trackBrowse(event: BrowseEventName, data: PixelData = {}, server: BrowseServerBody = {}) {
  const url = window.location.href.split("#")[0];
  whenReady(() => {
    if (!pixel) return;
    const eventId = newEventId(event);
    try {
      loadBase(pixel);
      window.fbq?.("trackSingle", pixel, event, data, { eventID: eventId });
    } catch {
      // The pixel failing never stops the page.
    }
    beacon({ event, eventId, url, ...server });
  });
}

/** The Lead the server queued for a placed order — same event_id, so Meta counts it once. */
export function trackOrderPlaced(track: { pixelId: string; event: "Lead"; eventId: string; data: PixelData } | null | undefined) {
  if (!track) return;
  try {
    loadBase(track.pixelId);
    window.fbq?.("trackSingle", track.pixelId, track.event, track.data, { eventID: track.eventId });
  } catch {
    // never in the way of the order
  }
}
