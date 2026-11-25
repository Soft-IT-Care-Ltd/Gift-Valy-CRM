import type { WebChoiceGroup, WebChoiceOption, WebStock } from "./types";

// ROUND3 W-4 — the product page's arithmetic over the choices, client- and
// server-safe. Nothing here prices anything itself: every option carries the
// priceDelta the gate worked out with packagePrice() (R3-2's one price
// function), and the groups are independent, so the price with any picks is
// the default price plus the picks' deltas. tests/storefront-pages checks
// this equals packagePrice() for real packages, nested ones and qty 2.

export type Picks = Record<number, number>; // group key → option key

/** The default option — or, when it is out of stock, the first one in stock. */
export function initialPicks(groups: WebChoiceGroup[]): Picks {
  const picks: Picks = {};
  for (const g of groups) {
    const def = g.options.find((o) => o.isDefault) ?? g.options[0];
    const pick = def?.stock === "IN_STOCK" ? def : (g.options.find((o) => o.stock === "IN_STOCK") ?? def);
    if (pick) picks[g.key] = pick.key;
  }
  return picks;
}

export function pickedOption(group: WebChoiceGroup, picks: Picks): WebChoiceOption | undefined {
  return group.options.find((o) => o.key === picks[group.key]) ?? group.options.find((o) => o.isDefault) ?? group.options[0];
}

/** ৳ for one piece with these picks. */
export function liveTotal(price: number, groups: WebChoiceGroup[], picks: Picks): number {
  let total = price;
  for (const g of groups) total += pickedOption(g, picks)?.priceDelta ?? 0;
  return Math.round(total * 100) / 100;
}

/**
 * Out when the package can't be made even with its starting picks (`stock`,
 * from the gate) or a picked option itself is out. Two picks sharing a part
 * that is short is rare and the order endpoint re-checks live (W-5).
 */
export function liveStock(stock: WebStock, groups: WebChoiceGroup[], picks: Picks): WebStock {
  if (stock === "OUT_OF_STOCK") return stock;
  return groups.some((g) => pickedOption(g, picks)?.stock === "OUT_OF_STOCK") ? "OUT_OF_STOCK" : "IN_STOCK";
}

/** Print-kit photos and cards the customer sends with these picks. */
export function liveKit(base: { photos: number; cards: number }, groups: WebChoiceGroup[], picks: Picks): { photos: number; cards: number } {
  let { photos, cards } = base;
  for (const g of groups) {
    const o = pickedOption(g, picks);
    photos += o?.printPhotosDelta ?? 0;
    cards += o?.printCardsDelta ?? 0;
  }
  return { photos: Math.max(0, photos), cards: Math.max(0, cards) };
}

/** "Saree Colour: Red saree" lines for the WhatsApp message. */
export function picksText(groups: WebChoiceGroup[], picks: Picks): string {
  return groups.map((g) => `${g.label}: ${pickedOption(g, picks)?.name ?? ""}`).join("\n");
}
