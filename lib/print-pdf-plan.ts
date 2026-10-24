// PHOTO_PRINT.md PP-6 — a kit + a layout → the print PDF's pages. Pure (no DB,
// no files): the PDF renderer (lib/print-pdf.ts) draws exactly what this
// returns, and tests/print-pdf.test.ts checks every piece's mm size, position,
// page bounds and gaps against it.
//
// A piece's position is the layout's data, its size the size setting — never
// scaled. Each kit starts on a new page; a layout page with nothing of this
// kit on it is dropped (a kit without cards skips the card page).
import {
  checkLayout,
  slotPixels,
  type LayoutBox,
  type PrintLayout,
  type PrintSizes,
  type PrintSlotValue,
} from "./print-layouts";

export class PrintPlanError extends Error {}

export interface KitForPrint {
  photos: { slot: "PHOTO_L" | "PHOTO_S"; position: number; file: string }[];
  cards: { slot: "CARD_1" | "CARD_2"; file: string }[];
}

/** What the info box says (Packing reads it, then cuts it off). */
export interface InfoForPrint {
  orderNo: string;
  recipientName: string;
  recipientPhone: string;
  /** "25 Oct 2026" · "ASAP" · "Any day" */
  delivery: string;
}

export interface PlannedImage {
  kind: "photo" | "card";
  slot: PrintSlotValue;
  /** Big 1…10 / Small 1…4 / 1 for a card. */
  n: number;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  /** The image's exact pixels at 300 DPI. */
  px: { w: number; h: number };
  file: string;
}

export interface PlannedInfo extends InfoForPrint {
  box: LayoutBox;
  /** "Page 1 of 2" — "Kit 1 of 2 · Page 1 of 2" when the order has more kits. */
  pageLabel: string;
}

export interface PlannedPage {
  kitNo: number;
  kitCount: number;
  pageNo: number;
  pageCount: number;
  images: PlannedImage[];
  info: PlannedInfo;
}

/** A4 in PDF points — the page is exactly this, never "fit". */
export const A4_PT = { w: 595.28, h: 841.89 } as const;
export const PT_PER_MM = 72 / 25.4;

export function planPrintPages(
  kits: KitForPrint[],
  layout: PrintLayout,
  sizes: PrintSizes,
  info: InfoForPrint
): PlannedPage[] {
  const problems = checkLayout(layout, sizes);
  if (problems.length) {
    throw new PrintPlanError(`The layout does not fit: ${problems.map((p) => p.message).join("; ")}`);
  }
  const pages: PlannedPage[] = [];
  kits.forEach((kit, k) => {
    const files = new Map<string, string>();
    for (const p of kit.photos) files.set(`${p.slot}:${p.position}`, p.file);
    for (const c of kit.cards) files.set(`${c.slot}:1`, c.file);

    // Every photo / card of the kit must have a place in the layout.
    const placed = new Set(layout.pages.flatMap((pg) => pg.pieces.map((p) => `${p.slot}:${p.n}`)));
    for (const key of files.keys()) {
      if (!placed.has(key)) throw new PrintPlanError(`${layout.label} has no place for ${key}`);
    }

    const kitPages = layout.pages
      .map((pg) => ({
        info: pg.info,
        images: pg.pieces.flatMap((p): PlannedImage[] => {
          const file = files.get(`${p.slot}:${p.n}`);
          if (!file) return [];
          const size = sizes[p.slot];
          return [
            {
              kind: p.slot === "CARD_1" || p.slot === "CARD_2" ? "card" : "photo",
              slot: p.slot,
              n: p.n,
              xMm: p.x,
              yMm: p.y,
              wMm: size.w,
              hMm: size.h,
              px: slotPixels(size),
              file,
            },
          ];
        }),
      }))
      .filter((pg) => pg.images.length > 0);

    kitPages.forEach((pg, i) => {
      const pageLabel =
        (kits.length > 1 ? `Kit ${k + 1} of ${kits.length} · ` : "") +
        `Page ${i + 1} of ${kitPages.length}`;
      pages.push({
        kitNo: k + 1,
        kitCount: kits.length,
        pageNo: i + 1,
        pageCount: kitPages.length,
        images: pg.images,
        info: { ...info, box: pg.info, pageLabel },
      });
    });
  });
  return pages;
}
