import type { RichBlock } from "@/lib/catalog-website-shape";

// ROUND3 W-3 — everything the public website can ever receive about the
// catalog. These are the ONLY shapes lib/storefront/catalog.ts returns; each
// field is named here on purpose. Never add cost, stock numbers, SKU /
// package code, supplier, staff or customer data — tests/storefront-catalog
// scans every public read for them.

/** "In stock" / "Out of stock" — never a number. */
export type WebStock = "IN_STOCK" | "OUT_OF_STOCK";
export type WebBadge = "NEW" | "BEST_SELLER" | "LIMITED" | null;

/** A photo, served at `${path}-<360|720|1080>.webp`. null = the branded placeholder. */
export type WebImage = { path: string; alt: string };

export type WebCard = {
  kind: "product" | "package";
  slug: string;
  name: string;
  /** ৳, with the default choices (packages). */
  price: number;
  compareAtPrice: number | null;
  badge: WebBadge;
  image: WebImage | null;
  stock: WebStock;
};

export type WebChoiceOption = {
  /** What the bag / order sends back for this option. */
  key: number;
  name: string;
  /** ৳ added per piece when picked (may be negative). */
  extraPrice: number;
  isDefault: boolean;
  /** The package's availability with this option picked (others default). */
  stock: WebStock;
  image: WebImage | null;
};

export type WebChoiceGroup = {
  key: number;
  label: string;
  /** Pieces of this choice per one package (extras count per piece). */
  qty: number;
  /** Sub-package names from the top ("Chocolate Box"), [] at the top level. */
  path: string[];
  options: WebChoiceOption[];
};

/** "What's inside" — names and quantities only. */
export type WebContentsLine = {
  name: string;
  qty: number;
  /** A choice the customer makes ("Saree — your choice"). */
  choice: boolean;
  children: WebContentsLine[];
};

export type WebCategoryRef = { name: string; slug: string };

export type WebItem = WebCard & {
  description: RichBlock[];
  categories: WebCategoryRef[];
  photos: WebImage[];
  choiceGroups: WebChoiceGroup[];
  /** null when the package hides it, or for a product. */
  contents: WebContentsLine[] | null;
  /** The item needs the customer's photos / cards (W-4 note: send them on WhatsApp). */
  needsPhotos: boolean;
  seoTitle: string;
  seoDescription: string;
};

export type WebCategory = {
  slug: string;
  name: string;
  description: RichBlock[];
  image: WebImage | null;
  featured: boolean;
  seoTitle: string;
  seoDescription: string;
};
