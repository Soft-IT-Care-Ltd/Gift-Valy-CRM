// ROUND3 W-3/W-5 — what "on the website" means, in one place: the catalog gate
// (catalog.ts) shows only these, and the order endpoint (place-order.ts)
// sells only these. Plain objects (no Prisma import), usable as Prisma where
// clauses.
//
// A product: SELLABLE, active, "Show on website" on, with an address.
// A package: active, shown, with an address (and a BOM that prices — checked
// where it's priced). A category: shown, with an address.

export const PRODUCT_ON_WEBSITE = {
  showOnWebsite: true,
  isActive: true,
  productType: "SELLABLE",
  slug: { not: null },
} as const;

export const PACKAGE_ON_WEBSITE = {
  showOnWebsite: true,
  isActive: true,
  slug: { not: null },
} as const;

export const CATEGORY_ON_WEBSITE = {
  showOnWebsite: true,
  slug: { not: null },
} as const;
