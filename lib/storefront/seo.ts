import type { WebItem } from "./types";

// ROUND3 W-8 — what search engines and link previews (Facebook, WhatsApp)
// get. Client- and server-safe.

/** The branded link-preview image (public/shop/og.png, 1200 × 630) — every page without a photo of its own. */
export const SHARE_IMAGE = { url: "/shop/og.png", width: 1200, height: 630 } as const;

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
