import type { MetadataRoute } from "next";
import { copy } from "./copy";
import type { WebItem } from "./types";

// ROUND3 W-8 — what search engines and link previews (Facebook, WhatsApp)
// get. Client- and server-safe.

/** The branded link-preview image (public/shop/og.png, 1200 × 630) — every page without a photo of its own. */
export const SHARE_IMAGE = { url: "/shop/og.png", width: 1200, height: 630 } as const;

/** The website's brand navy: the browser bar (viewport theme-color) and the manifest. */
export const STORE_THEME_COLOR = "#2c347c";

/**
 * W-10 follow-up — the website's own web app manifest, at this public path on
 * the website host only (app/(store)/storefront/site.webmanifest/route.ts;
 * the ERP host has no such route). The store's root layout links it, which
 * replaces the link Next adds to every page for the ERP's manifest
 * (app/manifest.ts) — the front door 404s ERP files on the website host, so
 * that link was a console error on every website page.
 */
export const STORE_MANIFEST_PATH = "/site.webmanifest";

/** "Add to Home screen" for a customer: the shop's name, navy, its own icon (public/shop/, 512 × 512); opens the shop with the browser's buttons kept. */
export function storeManifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: copy.brand.name,
    short_name: copy.brand.name,
    description: copy.brand.tagline,
    lang: copy.lang,
    start_url: "/",
    scope: "/",
    display: "minimal-ui",
    background_color: "#fffaf4",
    theme_color: STORE_THEME_COLOR,
    icons: [{ src: "/shop/icon.png", sizes: "512x512", type: "image/png", purpose: "any" }],
  };
}

/** A shown photo at its largest website size, for og:image. */
export const ogPhoto = (path: string | null | undefined) => (path ? { url: `${path}-1080.webp`, width: 1080, height: 1080 } : SHARE_IMAGE);

/** Product structured data (schema.org) for a product / package page: name, photos, price in taka, In stock / Out of stock. Nothing else. */
export function productJsonLd(item: WebItem, origin: string) {
  const images = (item.photos.length ? item.photos : item.image ? [item.image] : []).map((p) => `${origin}${p.path}-1080.webp`);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: item.name,
    ...(images.length ? { image: images } : {}),
    ...(item.seoDescription ? { description: item.seoDescription } : {}),
    url: `${origin}/p/${item.slug}`,
    offers: {
      "@type": "Offer",
      priceCurrency: "BDT",
      price: item.price.toFixed(2),
      availability: item.stock === "IN_STOCK" ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: `${origin}/p/${item.slug}`,
    },
  };
}

/** JSON for a <script type="application/ld+json">: "<" escaped so a name can't close the tag. */
export const jsonLdText = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
