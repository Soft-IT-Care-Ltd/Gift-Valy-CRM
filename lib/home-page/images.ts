import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { saveUpload } from "@/lib/file-storage";
import type { BannerImage } from "./layout";

// ROUND3 W-7 — home page banner photos: a DESKTOP and a MOBILE photo for each
// banner (owner's sizes: desktop 1920 × 700, mobile 1080 × 1350). Every upload
// is re-encoded here: EXIF orientation applied, resized to fit (desktop at
// most 1920 × 1200, mobile 1080 × 1600; never enlarged), written as WebP —
// sharp drops all metadata (EXIF, GPS) unless asked to keep it. Stored as
// UPLOAD_DIR/banner-<uuid>.webp (behind the staff login); the website serves
// its own resized copies at /img/banner-<uuid>-<720|1080|1600>.webp, only
// while the published home page or the draft uses the photo
// (lib/storefront/catalog.ts publicPhotoFile).

export type BannerKind = "desktop" | "mobile";
export const BANNER_MAX_BYTES = 10 * 1024 * 1024;
export const BANNER_TYPES = ["image/jpeg", "image/png", "image/webp"];

const MAX: Record<BannerKind, { width: number; height: number }> = { desktop: { width: 1920, height: 1200 }, mobile: { width: 1080, height: 1600 } };
const MIN_WIDTH: Record<BannerKind, number> = { desktop: 1000, mobile: 600 };

export class BannerImageError extends Error {}

export async function saveBannerImage(input: Buffer, kind: BannerKind): Promise<BannerImage> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input, { failOn: "error" }).metadata();
  } catch {
    throw new BannerImageError("That file is not a readable JPEG, PNG or WebP image");
  }
  if (!meta.width || !meta.height) throw new BannerImageError("That file is not a readable JPEG, PNG or WebP image");
  const width = meta.orientation && meta.orientation >= 5 ? meta.height : meta.width;
  if (width < MIN_WIDTH[kind]) {
    throw new BannerImageError(`A ${kind} banner needs to be at least ${MIN_WIDTH[kind]} px wide (this one is ${width} px)`);
  }
  const out = await sharp(input, { failOn: "error" })
    .rotate()
    .resize({ ...MAX[kind], fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const file = `banner-${randomUUID()}.webp`;
  await saveUpload(file, out.data);
  return { file, width: out.info.width, height: out.info.height };
}
