// PHOTO_PRINT.md PP-4 — the crop of one photo into its slot. Pure and
// client-safe: the crop dialog's preview and the server's print file run the
// SAME math, so what the SE sees is exactly what prints.
//
// A crop is { cx, cy, zoom }: the centre of the cut as fractions of the
// (upright) original, and a zoom ≥ 1. At zoom 1 the cut is the largest box of
// the slot's shape that fits the photo ("crop to fill" — never a white
// border); zoom 2 cuts half that width. Because it is stored as fractions, the
// same crop works for a big or a small slot and for the preview image.

export interface PhotoCrop {
  cx: number;
  cy: number;
  zoom: number;
}

export const CROP_MAX_ZOOM = 4;
/** Below this the print is likely blurry — a warning, never a block. */
export const LOW_RES_DPI = 150;

export const CENTER_CROP: PhotoCrop = { cx: 0.5, cy: 0.5, zoom: 1 };

export interface CropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Stored JSON → a valid crop (centre crop when malformed). */
export function normalizeCrop(json: unknown): PhotoCrop {
  const c = (json && typeof json === "object" ? json : {}) as Partial<PhotoCrop>;
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    cx: clamp(n(c.cx, 0.5), 0, 1),
    cy: clamp(n(c.cy, 0.5), 0, 1),
    zoom: clamp(n(c.zoom, 1), 1, CROP_MAX_ZOOM),
  };
}

/**
 * The cut, in pixels of an image `srcW × srcH`, for a slot of shape
 * `aspect` (= width / height). Always inside the image, at least 1 px.
 */
export function cropBox(srcW: number, srcH: number, aspect: number, crop: PhotoCrop): CropBox {
  const c = normalizeCrop(crop);
  let bw: number;
  let bh: number;
  if (srcW / srcH > aspect) {
    bh = srcH;
    bw = srcH * aspect;
  } else {
    bw = srcW;
    bh = srcW / aspect;
  }
  bw /= c.zoom;
  bh /= c.zoom;
  const width = Math.max(1, Math.min(srcW, Math.round(bw)));
  const height = Math.max(1, Math.min(srcH, Math.round(bh)));
  const left = Math.round(clamp(c.cx * srcW - bw / 2, 0, srcW - width));
  const top = Math.round(clamp(c.cy * srcH - bh / 2, 0, srcH - height));
  return { left, top, width, height };
}

/** The crop with its centre pulled back so the cut stays inside the photo —
 *  what the drag handler stores. */
export function clampCrop(srcW: number, srcH: number, aspect: number, crop: PhotoCrop): PhotoCrop {
  const c = normalizeCrop(crop);
  const box = cropBox(srcW, srcH, aspect, c);
  return {
    cx: (box.left + box.width / 2) / srcW,
    cy: (box.top + box.height / 2) / srcH,
    zoom: c.zoom,
  };
}

/** Print resolution of the cut on a slot `slotWidthMm` wide. */
export function cropDpi(box: CropBox, slotWidthMm: number): number {
  return box.width / (slotWidthMm / 25.4);
}

/** The default crop: centred on sharp's attention point (faces, detail). */
export function attentionCrop(srcW: number, srcH: number, x: number, y: number): PhotoCrop {
  return { cx: clamp(x / srcW, 0, 1), cy: clamp(y / srcH, 0, 1), zoom: 1 };
}

/** The stored crop JSON also keeps the attention focus as fx/fy, so "Reset"
 *  can return to it after the SE moved the crop. */
export function cropFocus(json: unknown): PhotoCrop {
  const c = (json && typeof json === "object" ? json : {}) as { fx?: unknown; fy?: unknown };
  return typeof c.fx === "number" && typeof c.fy === "number"
    ? { cx: clamp(c.fx, 0, 1), cy: clamp(c.fy, 0, 1), zoom: 1 }
    : CENTER_CROP;
}

/** A crop to store: the new crop plus the focus kept from `previous`. */
export function storedCrop(crop: PhotoCrop, previous: unknown): PhotoCrop & { fx: number; fy: number } {
  const f = cropFocus(previous);
  return { ...normalizeCrop(crop), fx: f.cx, fy: f.cy };
}
