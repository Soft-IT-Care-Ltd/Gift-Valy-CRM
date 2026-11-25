import { revalidateTag } from "next/cache";

// ROUND3 W-9 — the website's pages and their data are cached on the server
// (lib/storefront/cached.ts) and thrown away the moment what they show
// changes, so the very next page load is fresh:
//   sf:catalog  — a product, package or category saved, created or deleted
//                 (price, choice extra prices, BOM, photos, the website
//                 switch, slug, featured, sort order, delivery charges), the
//                 bulk Show/Hide, and any stock movement (In stock / Out of
//                 stock words) — lib/stock.ts applyMovements;
//   sf:settings — Settings → Website (W-7) and the currency rates;
//   sf:home     — the home page manager publishing (W-7).
// Every page is also rebuilt every 10 minutes as a safety net only.
//
// `{ expire: 0 }`: expired at once (not stale-while-revalidate), so nobody
// is served the old copy after a save. revalidateTag only queues the tag;
// Next applies it when the route handler finishes — after the caller's
// transaction has committed. Outside a request (seed, scripts, tests) or
// during a render there is nothing to clear, so it is a no-op.
//
// The cache lives in the app's one process (deploy/ecosystem*.config.cjs:
// fork, one instance per copy) — so one save clears it for every visitor.

export const STOREFRONT_TAGS = {
  catalog: "sf:catalog",
  settings: "sf:settings",
  home: "sf:home",
} as const;

/** Seconds a page may be served before it is rebuilt even if nothing said it changed. */
export const STOREFRONT_REVALIDATE_SECONDS = 600;

function expire(tag: string) {
  try {
    revalidateTag(tag, { expire: 0 });
  } catch {
    // Not inside a route handler / server action — nothing cached here to drop.
  }
}

/** Every page listing or showing an item: home, categories, item pages, search results' sources. */
export function revalidateStorefrontCatalog(): void {
  expire(STOREFRONT_TAGS.catalog);
}

/** Settings → Website or the currency rates changed. */
export function revalidateStorefrontSettings(): void {
  expire(STOREFRONT_TAGS.settings);
}

/** The home page manager published (W-7). */
export function revalidateStorefrontHome(): void {
  expire(STOREFRONT_TAGS.home);
}
