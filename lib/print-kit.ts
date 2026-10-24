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

// ---------- PP-4: kit progress + the wire shape of a kit ----------

export type KitState = "PHOTOS_PENDING" | "CARDS_PENDING" | "READY";

export interface KitProgress {
  photos: number;
  photosNeeded: number;
  cards: number;
  cardsNeeded: number;
  state: KitState;
}

export function kitProgress(kit: PrintKitSpec, photos: number, cards: number): KitProgress {
  const photosNeeded = printKitPhotoCount(kit);
  const cardsNeeded = kit.cards.length;
  const state: KitState =
    photos < photosNeeded ? "PHOTOS_PENDING" : cards < cardsNeeded ? "CARDS_PENDING" : "READY";
  return { photos, photosNeeded, cards, cardsNeeded, state };
}

/** "Photos pending 9/14" · "Cards pending 1/2" · "Ready to print" (+ Bangla). */
export function kitProgressLabel(p: KitProgress): { en: string; bn: string } {
  if (p.state === "PHOTOS_PENDING") {
    return { en: `Photos pending ${p.photos}/${p.photosNeeded}`, bn: `ছবি বাকি ${p.photos}/${p.photosNeeded}` };
  }
  if (p.state === "CARDS_PENDING") {
    return { en: `Cards pending ${p.cards}/${p.cardsNeeded}`, bn: `কার্ড বাকি ${p.cards}/${p.cardsNeeded}` };
  }
  return { en: "Ready to print", bn: "প্রিন্টের জন্য তৈরি" };
}

export type PrintKitStatusValue = "PENDING" | "READY" | "PRINTED" | "CHANGED_AFTER_PRINT";

export interface KitPhotoView {
  id: number;
  slot: PhotoSlot;
  position: number;
  /** Preview image (≤ 1200 px), signed-in route only. */
  url: string;
  crop: { cx: number; cy: number; zoom: number };
  /** sharp's attention point — where "Reset" puts the crop. */
  focus: { cx: number; cy: number; zoom: number };
  /** Upright size of the ORIGINAL — the crop math runs on it. */
  srcWidth: number;
  srcHeight: number;
  lowRes: boolean;
}

export interface KitCardView {
  slot: CardSlot;
  designId: number;
  designName: string;
  messageId: number | null;
  text: string;
  toName: string | null;
  fromName: string | null;
  renderUrl: string | null;
  fontPt: number | null;
}

export interface KitView {
  id: number;
  sourceKey: string;
  /** "Customize Chocolate Box — Kit 1 of 2 · Probashi Combo" */
  label: string;
  spec: PrintKitSpec;
  status: PrintKitStatusValue;
  progress: KitProgress;
  orphaned: boolean;
  printedAt: string | null;
  photos: KitPhotoView[];
  cards: KitCardView[];
}

// ---------- PP-4: one order's kits → the order-list badge ----------

export interface OrderPrintSummary {
  state: "PENDING" | "READY" | "PRINTED" | "CHANGED_AFTER_PRINT";
  /** "Photos pending 9/14" · "Cards pending" · "Ready to print" · … */
  label: string;
  labelBn: string;
}

export const PRINT_FILTERS = ["pending", "ready", "printed", "changed"] as const;
export type PrintFilter = (typeof PRINT_FILTERS)[number];
export const PRINT_FILTER_LABELS: Record<PrintFilter, string> = {
  pending: "Photos & cards pending",
  ready: "Ready to print",
  printed: "Printed",
  changed: "Changed after print",
};
export const PRINT_FILTER_STATUS: Record<PrintFilter, PrintKitStatusValue> = {
  pending: "PENDING",
  ready: "READY",
  printed: "PRINTED",
  changed: "CHANGED_AFTER_PRINT",
};

/** Kits of an order (line-removed kits excluded) → one badge; null = no kit. */
export function orderPrintSummary(
  kits: { status: string; photoCount: number; cardCount: number; spec: unknown; orphanedAt: Date | string | null }[]
): OrderPrintSummary | null {
  const live = kits.filter((k) => !k.orphanedAt);
  if (live.length === 0) return null;
  if (live.some((k) => k.status === "CHANGED_AFTER_PRINT")) {
    return { state: "CHANGED_AFTER_PRINT", label: "Changed after print — reprint", labelBn: "প্রিন্টের পর বদলেছে — আবার প্রিন্ট" };
  }
  let photos = 0;
  let photosNeeded = 0;
  let cards = 0;
  let cardsNeeded = 0;
  for (const k of live) {
    const spec = normalizePrintKit(k.spec);
    if (!spec) continue;
    photos += Math.min(k.photoCount, printKitPhotoCount(spec));
    photosNeeded += printKitPhotoCount(spec);
    cards += Math.min(k.cardCount, spec.cards.length);
    cardsNeeded += spec.cards.length;
  }
  if (photos < photosNeeded || cards < cardsNeeded) {
    const lab = kitProgressLabel({
      photos,
      photosNeeded,
      cards,
      cardsNeeded,
      state: photos < photosNeeded ? "PHOTOS_PENDING" : "CARDS_PENDING",
    });
    return { state: "PENDING", label: lab.en, labelBn: lab.bn };
  }
  if (live.every((k) => k.status === "PRINTED")) {
    return { state: "PRINTED", label: "Printed", labelBn: "প্রিন্ট হয়েছে" };
  }
  return { state: "READY", label: "Ready to print", labelBn: "প্রিন্টের জন্য তৈরি" };
}

/** PP-7 — shown (never blocking) when an order is packed before its photos
 *  and cards were printed. */
export const PACKED_UNPRINTED_WARNING =
  "ছবি/কার্ড এখনো প্রিন্ট হয়নি — বক্সে দিয়েছেন তো? / Photos & cards are not marked printed — make sure they are in the box";
