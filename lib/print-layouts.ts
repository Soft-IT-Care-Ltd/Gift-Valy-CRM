// PHOTO_PRINT.md PP-1 / PP-6 — print sizes, the two A4 layouts and the layout
// check. Pure and client-safe: the Settings page, the PDF builder (PP-6) and
// the tests all run off these.
//
// The layouts are DATA — per page, the top-left corner (mm from the page's
// top-left) of every piece plus the one info box — copied from "The layout"
// in PHOTO_PRINT.md. A piece's size always comes from the size settings, never
// from here, so a size change is checked against the fixed positions: pieces
// never move and are never scaled.

export const PRINT_SLOTS = ["PHOTO_L", "PHOTO_S", "CARD_1", "CARD_2"] as const;
export type PrintSlotValue = (typeof PRINT_SLOTS)[number];
export type PhotoSlot = "PHOTO_L" | "PHOTO_S";
export type CardSlot = "CARD_1" | "CARD_2";

export const PRINT_SLOT_LABELS: Record<PrintSlotValue, string> = {
  PHOTO_L: "Big photo",
  PHOTO_S: "Small photo",
  CARD_1: "Card 1",
  CARD_2: "Card 2",
};

/** Short piece names used in layout-check messages ("Big 3", "Card 1"). */
const PIECE_NAMES: Record<PrintSlotValue, string> = {
  PHOTO_L: "Big",
  PHOTO_S: "Small",
  CARD_1: "Card",
  CARD_2: "Card",
};

export interface PrintSize {
  /** Width in mm. */
  w: number;
  /** Height in mm. */
  h: number;
}
export type PrintSizes = Record<PrintSlotValue, PrintSize>;

/** Measured from the owner's sample (±0.5 mm) — corrected in Settings. */
export const DEFAULT_PRINT_SIZES: PrintSizes = {
  PHOTO_L: { w: 76.2, h: 77.6 },
  PHOTO_S: { w: 38.3, h: 37.2 },
  CARD_1: { w: 126.3, h: 126.5 },
  CARD_2: { w: 99.2, h: 99.5 },
};

export const PRINT_DPI = 300;
export const A4_MM = { w: 210, h: 297 } as const;

/** Exact pixel count of `mm` at 300 DPI (76.2 mm → 900 px). */
export function mmToPx(mm: number): number {
  return Math.round((mm / 25.4) * PRINT_DPI);
}

export function slotPixels(size: PrintSize): { w: number; h: number } {
  return { w: mmToPx(size.w), h: mmToPx(size.h) };
}

// ---------- the layouts ----------

export interface LayoutPiece {
  slot: PrintSlotValue;
  /** 1-based number within its slot (Big 1 … Big 10). */
  n: number;
  x: number;
  y: number;
}

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutPage {
  pieces: LayoutPiece[];
  /** The one info box (order no., recipient, phone, delivery date, page N of M). */
  info: LayoutBox;
}

export const PRINT_LAYOUT_IDS = ["SAFE_3", "BORDERLESS_2"] as const;
export type PrintLayoutId = (typeof PRINT_LAYOUT_IDS)[number];

export interface PrintLayout {
  id: PrintLayoutId;
  label: string;
  /** Minimum white space between any two pieces (for the scissors), mm. */
  gap: number;
  /** Needs a printer that prints borderless without enlarging. */
  borderless: boolean;
  pages: LayoutPage[];
}

const big = (n: number, x: number, y: number): LayoutPiece => ({ slot: "PHOTO_L", n, x, y });
const small = (n: number, x: number, y: number): LayoutPiece => ({ slot: "PHOTO_S", n, x, y });

export const PRINT_LAYOUTS: Record<PrintLayoutId, PrintLayout> = {
  SAFE_3: {
    id: "SAFE_3",
    label: "3 pages (safe) — any printer",
    gap: 4,
    borderless: false,
    pages: [
      {
        pieces: [
          big(1, 5, 5), big(2, 85.2, 5),
          big(3, 5, 86.6), big(4, 85.2, 86.6),
          big(5, 5, 168.2), big(6, 85.2, 168.2),
          small(1, 165.4, 5), small(2, 165.4, 46.2),
          small(3, 165.4, 87.4), small(4, 165.4, 128.6),
        ],
        info: { x: 165.4, y: 169.8, w: 38.3, h: 48 },
      },
      {
        pieces: [
          big(7, 5, 5), big(8, 85.2, 5),
          big(9, 5, 86.6), big(10, 85.2, 86.6),
          { slot: "CARD_2", n: 1, x: 5, y: 168.2 },
        ],
        info: { x: 108.2, y: 168.2, w: 60, h: 48 },
      },
      {
        pieces: [{ slot: "CARD_1", n: 1, x: 5, y: 5 }],
        info: { x: 135.3, y: 5, w: 60, h: 48 },
      },
    ],
  },
  BORDERLESS_2: {
    id: "BORDERLESS_2",
    label: "2 pages (borderless printer only)",
    gap: 3,
    borderless: true,
    pages: [
      {
        pieces: [
          { slot: "CARD_1", n: 1, x: 2.25, y: 4.65 },
          big(1, 131.55, 4.65),
          small(1, 131.55, 85.25),
          big(2, 2.25, 134.15), big(3, 81.45, 134.15),
          big(4, 2.25, 214.75), big(5, 81.45, 214.75),
          small(2, 160.65, 134.15), small(3, 160.65, 174.35), small(4, 160.65, 214.55),
        ],
        info: { x: 172.85, y: 85.25, w: 34.9, h: 45.9 },
      },
      {
        pieces: [
          { slot: "CARD_2", n: 1, x: 15.8, y: 18.15 },
          big(6, 15.8, 120.65), big(7, 15.8, 201.25),
          big(8, 118, 18.15), big(9, 118, 98.75), big(10, 118, 179.35),
        ],
        info: { x: 118, y: 259.95, w: 76.2, h: 30 },
      },
    ],
  },
};

// The owner chose 2 pages (borderless) as the default for PP3 (24 Oct 2026).
export const DEFAULT_PRINT_LAYOUT: PrintLayoutId = "BORDERLESS_2";

// ---------- the layout check (PP-1 save guard + PP-6 test) ----------

/** Float tolerance: positions are given to 0.05 mm. */
const EPS = 0.001;

export interface LayoutProblem {
  page: number;
  message: string;
}

interface PlacedBox extends LayoutBox {
  name: string;
}

function pieceName(p: LayoutPiece): string {
  return p.slot === "CARD_1" || p.slot === "CARD_2"
    ? PRINT_SLOT_LABELS[p.slot]
    : `${PIECE_NAMES[p.slot]} ${p.n}`;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Every piece (and the info box) of one page at its real size. */
export function placedBoxes(page: LayoutPage, sizes: PrintSizes): PlacedBox[] {
  return [
    ...page.pieces.map((p) => ({
      name: pieceName(p),
      x: p.x,
      y: p.y,
      w: sizes[p.slot].w,
      h: sizes[p.slot].h,
    })),
    { name: "Info box", ...page.info },
  ];
}

/** How many of each slot the layout holds — must cover the kit it prints. */
export function layoutSlotCounts(layout: PrintLayout): Record<PrintSlotValue, number> {
  const counts: Record<PrintSlotValue, number> = { PHOTO_L: 0, PHOTO_S: 0, CARD_1: 0, CARD_2: 0 };
  for (const page of layout.pages) for (const p of page.pieces) counts[p.slot]++;
  return counts;
}

/**
 * Every piece inside the A4 page, and no two pieces (info box included)
 * closer than the layout's gap. Returns one human-readable problem per
 * violation — empty means the layout prints as-is. Never scales anything.
 */
export function checkLayout(layout: PrintLayout, sizes: PrintSizes): LayoutProblem[] {
  const problems: LayoutProblem[] = [];
  layout.pages.forEach((page, i) => {
    const pageNo = i + 1;
    const boxes = placedBoxes(page, sizes);
    for (const b of boxes) {
      const over = Math.max(-b.x, -b.y, b.x + b.w - A4_MM.w, b.y + b.h - A4_MM.h);
      if (over > EPS) {
        problems.push({
          page: pageNo,
          message: `Page ${pageNo}: ${b.name} runs ${r1(over)} mm off the page`,
        });
      }
    }
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const A = boxes[a];
        const B = boxes[b];
        // Separation along whichever axis keeps them apart (negative = overlap).
        const dx = Math.max(B.x - (A.x + A.w), A.x - (B.x + B.w));
        const dy = Math.max(B.y - (A.y + A.h), A.y - (B.y + B.h));
        const apart = Math.max(dx, dy);
        if (apart < layout.gap - EPS) {
          problems.push({
            page: pageNo,
            message:
              apart < -EPS
                ? `Page ${pageNo}: ${A.name} and ${B.name} overlap by ${r1(-apart)} mm`
                : `Page ${pageNo}: ${A.name} and ${B.name} are ${r1(layout.gap - apart)} mm too close (need a ${layout.gap} mm gap)`,
          });
        }
      }
    }
  });
  return problems;
}

// ---------- settings shape ----------

export interface PrintSettings {
  sizes: PrintSizes;
  layout: PrintLayoutId;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  sizes: DEFAULT_PRINT_SIZES,
  layout: DEFAULT_PRINT_LAYOUT,
};

/** Smallest / largest size the Settings form accepts (mm). */
export const PRINT_SIZE_MIN_MM = 10;
export const PRINT_SIZE_MAX_MM = 200;

/** Tolerant reader for the stored JSON — anything missing or out of range
 *  falls back to the default, so a bad row can never break printing. */
export function normalizePrintSettings(json: unknown): PrintSettings {
  const src = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const rawSizes = (src.sizes && typeof src.sizes === "object" ? src.sizes : {}) as Record<
    string,
    unknown
  >;
  const sizes = {} as PrintSizes;
  for (const slot of PRINT_SLOTS) {
    const s = rawSizes[slot] as Partial<PrintSize> | undefined;
    const ok = (v: unknown): v is number =>
      typeof v === "number" && v >= PRINT_SIZE_MIN_MM && v <= PRINT_SIZE_MAX_MM;
    sizes[slot] =
      s && ok(s.w) && ok(s.h) ? { w: r1(s.w), h: r1(s.h) } : DEFAULT_PRINT_SIZES[slot];
  }
  const layout = PRINT_LAYOUT_IDS.includes(src.layout as PrintLayoutId)
    ? (src.layout as PrintLayoutId)
    : DEFAULT_PRINT_LAYOUT;
  return { sizes, layout };
}
