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
  /** A package: can it be made with its starting picks (each group's default, or its first option in stock). */
  stock: WebStock;
  /** Photos the customer sends for printing (a print kit, default picks); 0 = none. */
  printPhotos: number;
};

export type WebChoiceOption = {
  /** What the bag / order sends back for this option. */
  key: number;
  name: string;
  /** ৳ added per piece when picked (may be negative). */
  extraPrice: number;
  isDefault: boolean;
  /**
   * ৳ the package's price moves by when this option is picked instead of the
   * group's default — packagePrice(with it) − packagePrice(defaults). The page's
   * live total is price + Σ priceDelta of the picks (groups are independent).
   */
  priceDelta: number;
  /** Whether this option itself can be supplied (qty pieces of it for one package). */
  stock: WebStock;
  image: WebImage | null;
  /** Change in print-kit photos / cards vs the default option. */
  printPhotosDelta: number;
  printCardsDelta: number;
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
  /** For a choice line: its group's key, so the page can show the current pick. */
  groupKey: number | null;
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
  /** Print-kit cards the customer writes a message for (default picks); 0 = none. */
  printCards: number;
  /** ৳ delivery charge for one piece, per zone (the order form's own figures). */
  delivery: WebDelivery;
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

export type WebDelivery = { insideDhaka: number; subDhaka: number; outsideDhaka: number };

/** ROUND3 W-4 — an active currency for the optional "≈ SAR 120 (approx.)" line. */
export type WebCurrency = { iso: string; label: string; symbol: string | null; takaPerUnit: number };

/** ROUND3 W-5 — a bag line as the website sends it back to be re-read. */
export type WebBagLineIn = { kind: "product" | "package"; slug: string; picks: Record<string, number> };

/** ROUND3 W-5 — a bag line as it stands now (the bag and checkout show this, never what was saved). */
export type WebBagLine = {
  kind: "product" | "package";
  slug: string;
  name: string;
  image: WebImage | null;
  /** The picks as they stand: a saved option no longer offered → its group's default. */
  picks: Record<string, number>;
  /** "Saree Colour: Red saree" — every choice group with its current pick. */
  choices: { label: string; name: string }[];
  /** A saved pick was no longer offered and was replaced. */
  choicesChanged: boolean;
  /** ৳ for one piece with these picks — packagePrice(), as the order endpoint prices it. */
  price: number;
  stock: WebStock;
  delivery: WebDelivery;
  printPhotos: number;
  printCards: number;
};
