import path from "node:path";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import * as fontkit from "fontkit";
import { printFontPath, uploadUrlPath } from "./file-storage";
import { slotPixels, type PrintSize } from "./print-layouts";

// ============ PHOTO_PRINT.md PP-3 / PP-6 — a wishing card at 300 DPI ============
//
// The card text is rendered by sharp (libvips → Pango + HarfBuzz), NOT pdfkit:
// pdfkit's fontkit shaper gives some Bangla conjuncts the wrong advance width
// (দ্ধ in শ্রদ্ধা / শুদ্ধ overlaps the next letter and swallows the space).
// The finished card is one PNG that the print PDF places as an image.
//
// Fonts: on Linux (the server) Pango loads exactly the design's font file.
// On macOS sharp's Pango uses the system's fonts instead of that file, so a
// dev preview on a Mac shows a macOS Bangla font — the printed card on the
// server uses the real one.

export const DEFAULT_CARD_FONT = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "public",
  "fonts",
  "NotoSansBengali-Bold.ttf"
);

export interface CardTextBox {
  /** Left edge, % of the card width. */
  x: number;
  /** Top edge, % of the card height. */
  y: number;
  /** Width, % of the card width. */
  w: number;
  /** Height, % of the card height. */
  h: number;
}

export interface CardDesignForRender {
  backgroundPath: string | null;
  textBox: CardTextBox;
  textColor: string;
  align: "LEFT" | "CENTER" | "RIGHT";
  fontPath: string | null;
  maxFontPt: number;
  minFontPt: number;
}

export interface RenderedCard {
  png: Buffer;
  width: number;
  height: number;
  /** The font size the text fitted at. */
  fontPt: number;
  /** false = even at the minimum size the text overflows the text box. */
  fits: boolean;
}

/** Parses a stored text_box, clamping it inside the card (a sane default when
 *  the JSON is malformed). */
export function normalizeTextBox(json: unknown): CardTextBox {
  const src = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const x = Math.min(95, Math.max(0, num(src.x, 10)));
  const y = Math.min(95, Math.max(0, num(src.y, 10)));
  const w = Math.min(100 - x, Math.max(5, num(src.w, 80)));
  const h = Math.min(100 - y, Math.max(5, num(src.h, 50)));
  return { x, y, w, h };
}

const familyCache = new Map<string, string>();

/** The family name Pango must ask for to get this exact font file. */
function fontFamily(file: string): string {
  let family = familyCache.get(file);
  if (!family) {
    const opened = fontkit.openSync(file);
    const font = "fonts" in opened ? opened.fonts[0] : opened;
    family = `${font.familyName} ${font.subfamilyName}`.trim();
    familyCache.set(file, family);
  }
  return family;
}

function escapeMarkup(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A colour Pango accepts (#rgb / #rrggbb), else the design default. */
function safeColor(c: string): string {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : "#be185d";
}

async function renderText(
  lines: string[],
  pt: number,
  widthPx: number,
  design: CardDesignForRender,
  fontFile: string
) {
  const markup = `<span foreground="${safeColor(design.textColor)}">${lines
    .map(escapeMarkup)
    .join("\n")}</span>`;
  return sharp({
    text: {
      text: markup,
      font: `${fontFamily(fontFile)} ${pt}`,
      fontfile: fontFile,
      width: widthPx,
      dpi: 300,
      rgba: true,
      wrap: "word",
      align: design.align === "LEFT" ? "left" : design.align === "RIGHT" ? "right" : "centre",
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
}

async function background(design: CardDesignForRender, w: number, h: number): Promise<Buffer> {
  const file = uploadUrlPath(design.backgroundPath);
  if (file) {
    try {
      return await sharp(await readFile(file))
        .rotate()
        .toColourspace("srgb")
        .resize(w, h, { fit: "cover" })
        .png()
        .toBuffer();
    } catch {
      // A missing/unreadable background falls through to the blank card.
    }
  }
  return sharp({ create: { width: w, height: h, channels: 3, background: "#ffffff" } })
    .png()
    .toBuffer();
}

/**
 * The card at its exact print size (300 DPI): the design's background,
 * cover-cropped to the card, with `lines` written inside the text box. The
 * text starts at the design's maximum size and shrinks in 0.5 pt steps until
 * it fits the box; at the minimum size it is placed anyway and `fits` is false
 * (the SE is asked to shorten the message).
 */
export async function renderCard(
  design: CardDesignForRender,
  size: PrintSize,
  lines: string[]
): Promise<RenderedCard> {
  const { w, h } = slotPixels(size);
  const box = design.textBox;
  const boxW = Math.max(1, Math.round((box.w / 100) * w));
  const boxH = Math.max(1, Math.round((box.h / 100) * h));
  const fontFile = printFontPath(design.fontPath) ?? DEFAULT_CARD_FONT;
  const bg = await background(design, w, h);
  if (lines.length === 0) {
    return { png: bg, width: w, height: h, fontPt: design.maxFontPt, fits: true };
  }

  const fitsAt = async (pt: number) => {
    const r = await renderText(lines, pt, boxW, design, fontFile);
    return { r, ok: r.info.width <= boxW && r.info.height <= boxH };
  };
  // Largest size in [min, max] (0.5 pt grid) that fits — binary search.
  const steps = Math.max(0, Math.round((design.maxFontPt - design.minFontPt) * 2));
  let best = await fitsAt(design.minFontPt);
  let bestPt = design.minFontPt;
  if (best.ok) {
    let lo = 1;
    let hi = steps;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const pt = design.minFontPt + mid / 2;
      const attempt = await fitsAt(pt);
      if (attempt.ok) {
        best = attempt;
        bestPt = pt;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
  }

  const text = best.r;
  const left0 = Math.round((box.x / 100) * w);
  const top0 = Math.round((box.y / 100) * h);
  // Horizontal: Pango already aligned the lines within boxW; centre the block
  // vertically. Clamp so an overflowing text still lands on the card.
  const tw = Math.min(text.info.width, w);
  const th = Math.min(text.info.height, h);
  const dx =
    design.align === "LEFT" ? 0 : design.align === "RIGHT" ? boxW - tw : Math.round((boxW - tw) / 2);
  const left = Math.max(0, Math.min(w - tw, left0 + dx));
  const top = Math.max(0, Math.min(h - th, top0 + Math.round((boxH - th) / 2)));
  const textImg =
    text.info.width > w || text.info.height > h
      ? await sharp(text.data).extract({ left: 0, top: 0, width: tw, height: th }).png().toBuffer()
      : text.data;

  const png = await sharp(bg)
    .composite([{ input: textImg, left, top }])
    .withMetadata({ density: 300 })
    .png()
    .toBuffer();
  return { png, width: w, height: h, fontPt: bestPt, fits: best.ok };
}

/** Reads an uploaded font: its display name and whether it covers Bangla.
 *  Throws if the data is not a font fontkit can parse. */
export function inspectFont(data: Buffer): { family: string; bangla: boolean } {
  const parsed = fontkit.create(data);
  const font = "fonts" in parsed ? parsed.fonts[0] : parsed;
  return {
    family: `${font.familyName} ${font.subfamilyName}`.trim(),
    bangla: font.hasGlyphForCodePoint(0x0995), // ক
  };
}

/** Display name of a stored card font (null = the default Noto Sans Bengali Bold). */
export function fontDisplayName(fontPath: string | null): string {
  const file = printFontPath(fontPath);
  if (!file) return "Noto Sans Bengali Bold (default)";
  try {
    return fontFamily(file);
  } catch {
    return `${fontPath} (unreadable)`;
  }
}
