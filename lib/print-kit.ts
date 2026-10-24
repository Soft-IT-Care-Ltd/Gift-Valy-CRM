// PHOTO_PRINT.md PP-2 — the print kit a product carries: how many customer
// photos of each size and which wishing cards ONE unit needs. Client-safe
// (the product form uses it); stored as products.print_kit and frozen onto
// order_print_kits.spec_snapshot when an order line is saved.
import { z } from "zod";
import {
  PRINT_LAYOUTS,
  layoutSlotCounts,
  type CardSlot,
  type PhotoSlot,
} from "./print-layouts";

export interface PrintKitSpec {
  photos: Record<PhotoSlot, number>;
  cards: CardSlot[];
}

/** The Customize Chocolate Box: 10 big + 4 small photos, both cards. */
export const DEFAULT_PRINT_KIT: PrintKitSpec = {
  photos: { PHOTO_L: 10, PHOTO_S: 4 },
  cards: ["CARD_1", "CARD_2"],
};

/** A kit must fit every layout — the most of each slot all layouts hold. */
export const PRINT_KIT_MAX: Record<PhotoSlot, number> = (() => {
  const all = Object.values(PRINT_LAYOUTS).map(layoutSlotCounts);
  return {
    PHOTO_L: Math.min(...all.map((c) => c.PHOTO_L)),
    PHOTO_S: Math.min(...all.map((c) => c.PHOTO_S)),
  };
})();

const CARD_SLOTS: CardSlot[] = ["CARD_1", "CARD_2"];

/** Stored JSON → a valid kit, or null for "no kit" (also for an empty kit,
 *  malformed JSON or counts beyond what a layout can print). */
export function normalizePrintKit(json: unknown): PrintKitSpec | null {
  if (!json || typeof json !== "object") return null;
  const src = json as { photos?: Record<string, unknown>; cards?: unknown };
  const count = (slot: PhotoSlot) => {
    const v = src.photos?.[slot];
    return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= PRINT_KIT_MAX[slot]
      ? v
      : null;
  };
  const L = count("PHOTO_L");
  const S = count("PHOTO_S");
  if (L === null || S === null) return null;
  const cards = Array.isArray(src.cards)
    ? CARD_SLOTS.filter((c) => (src.cards as unknown[]).includes(c))
    : [];
  if (L + S === 0 && cards.length === 0) return null;
  return { photos: { PHOTO_L: L, PHOTO_S: S }, cards };
}

export function printKitPhotoCount(kit: PrintKitSpec): number {
  return kit.photos.PHOTO_L + kit.photos.PHOTO_S;
}

/** "10 big + 4 small photos · Card 1 + Card 2" */
export function describePrintKit(kit: PrintKitSpec): string {
  const parts: string[] = [];
  const photos = [
    kit.photos.PHOTO_L ? `${kit.photos.PHOTO_L} big` : null,
    kit.photos.PHOTO_S ? `${kit.photos.PHOTO_S} small` : null,
  ].filter(Boolean);
  if (photos.length) parts.push(`${photos.join(" + ")} photos`);
  if (kit.cards.length) parts.push(kit.cards.map((c) => (c === "CARD_1" ? "Card 1" : "Card 2")).join(" + "));
  return parts.join(" · ");
}

/** The product form's kit field (API input). An empty kit means "no kit". */
export const printKitInputSchema = z.object({
  photos: z.object({
    PHOTO_L: z.number().int().min(0).max(PRINT_KIT_MAX.PHOTO_L),
    PHOTO_S: z.number().int().min(0).max(PRINT_KIT_MAX.PHOTO_S),
  }),
  cards: z.array(z.enum(["CARD_1", "CARD_2"])).max(2),
});
