import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import sharp from "sharp";
import { printFilePath, savePrintFile } from "./file-storage";
import { slotPixels, type PhotoSlot, type PrintSizes } from "./print-layouts";
import {
  LOW_RES_DPI,
  attentionCrop,
  cropBox,
  cropDpi,
  type PhotoCrop,
} from "./print-crop";

// ============ PHOTO_PRINT.md PP-4 — a customer photo → its print file ============
//
// The original is kept exactly as uploaded (the SE may re-crop later). Next to
// it: a ≤ 1200 px upright preview for the screen, and per slot + crop the
// 300 DPI print file — EXIF-rotated, sRGB, cut with lib/print-crop.ts (the
// same math as the crop dialog) and resized to the slot's exact pixels.

/** One photo per request; the browser re-encodes anything larger than ~10 MB
 *  (Nginx allows 12 MB per request). */
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const PREVIEW_MAX = 1200;
const ACCEPTED: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp" };

export class PhotoError extends Error {}

export function previewName(originalPath: string): string {
  return `${originalPath.replace(/\.[a-z]+$/, "")}-preview.jpg`;
}

export interface StoredOriginal {
  originalPath: string;
  srcWidth: number;
  srcHeight: number;
  srcBytes: number;
  crop: PhotoCrop & { fx: number; fy: number };
}

/** Validates (by content, not file name), writes the original + preview, and
 *  finds the default crop focus with sharp's attention strategy. */
export async function storeOriginal(data: Buffer): Promise<StoredOriginal> {
  if (data.length > PHOTO_MAX_BYTES) throw new PhotoError("Photo must be 15MB or smaller");
  const meta = await sharp(data).metadata().catch(() => null);
  const ext = meta?.format ? ACCEPTED[meta.format] : undefined;
  if (!meta || !ext || !meta.width || !meta.height) {
    throw new PhotoError("Only JPEG, PNG or WebP photos can be used");
  }
  // Upright size (EXIF orientations 5–8 swap width and height).
  const upright = meta.autoOrient ?? {
    width: (meta.orientation ?? 1) >= 5 ? meta.height : meta.width,
    height: (meta.orientation ?? 1) >= 5 ? meta.width : meta.height,
  };

  const preview = await sharp(data)
    .rotate()
    .toColourspace("srgb")
    .resize(PREVIEW_MAX, PREVIEW_MAX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });

  // Attention on the small preview (fast), scaled back to the original.
  const square = Math.min(preview.info.width, preview.info.height);
  const focus = await sharp(preview.data)
    .resize(square, square, { fit: "cover", position: "attention" })
    .toBuffer({ resolveWithObject: true });
  const info = focus.info as typeof focus.info & { attentionX?: number; attentionY?: number };
  const focus0 =
    typeof info.attentionX === "number" && typeof info.attentionY === "number"
      ? attentionCrop(preview.info.width, preview.info.height, info.attentionX, info.attentionY)
      : { cx: 0.5, cy: 0.5, zoom: 1 };
  // The focus is kept as fx/fy for the crop dialog's "Reset".
  const crop = { ...focus0, fx: focus0.cx, fy: focus0.cy };

  const id = randomUUID();
  const originalPath = await savePrintFile(`${id}.${ext}`, data);
  await savePrintFile(previewName(originalPath), preview.data);
  return {
    originalPath,
    srcWidth: upright.width,
    srcHeight: upright.height,
    srcBytes: data.length,
    crop,
  };
}

export interface PhotoForPrint {
  originalPath: string;
  srcWidth: number;
  srcHeight: number;
  crop: PhotoCrop;
}

/** Is this crop below 150 DPI on this slot? */
export function isLowRes(photo: Omit<PhotoForPrint, "originalPath">, slot: PhotoSlot, sizes: PrintSizes): boolean {
  const size = sizes[slot];
  const box = cropBox(photo.srcWidth, photo.srcHeight, size.w / size.h, photo.crop);
  return cropDpi(box, size.w) < LOW_RES_DPI;
}

/**
 * Writes the 300 DPI print file for this slot + crop and returns its name.
 * The name carries a hash of (slot, size, crop), so a changed crop or size
 * gives a new file and nothing stale is ever printed.
 */
export async function makePrintFile(
  photo: PhotoForPrint,
  slot: PhotoSlot,
  sizes: PrintSizes
): Promise<{ printPath: string; lowRes: boolean }> {
  const file = printFilePath(photo.originalPath);
  if (!file) throw new PhotoError("Photo file is missing");
  const size = sizes[slot];
  const px = slotPixels(size);
  const box = cropBox(photo.srcWidth, photo.srcHeight, size.w / size.h, photo.crop);
  const rev = createHash("sha1")
    .update(JSON.stringify([slot, size, box]))
    .digest("hex")
    .slice(0, 10);
  const base = photo.originalPath.replace(/\.[a-z]+$/, "");
  const name = `${base}-print-${rev}.jpg`;
  const lowRes = cropDpi(box, size.w) < LOW_RES_DPI;
  // Same name = same slot, size and crop = same pixels: reuse it (PP-6 asks
  // for every photo's file on each PDF build).
  const existing = printFilePath(name);
  if (existing && (await stat(existing).catch(() => null))?.isFile()) return { printPath: name, lowRes };
  const jpg = await sharp(await readFile(file))
    .rotate() // EXIF first — the box is in upright pixels
    .extract(box)
    .resize(px.w, px.h, { fit: "fill" }) // the box already has the slot's shape
    .toColourspace("srgb")
    .withMetadata({ density: 300 })
    .jpeg({ quality: 92 })
    .toBuffer();
  const printPath = await savePrintFile(name, jpg);
  return { printPath, lowRes };
}
