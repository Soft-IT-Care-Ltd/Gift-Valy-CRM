import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import sharp from "sharp";
import { saveUpload, uploadUrlPath } from "./file-storage";

// ============ ROUND3 R3-1 — the optional category photo ============
//
// One photo per category, stored like other uploads (UPLOAD_DIR, served to
// staff by app/uploads/[...path]; the website will serve it through /img,
// W-3). Every upload is re-encoded here: EXIF orientation applied, then
// resized to fit 1200 × 1200 (never enlarged), written as WebP. sharp drops
// all metadata (EXIF, GPS, ICC) unless asked to keep it, so the stored file
// carries none. The name — category-<uuid>.webp — marks the file as owned by
// exactly one category, so replacing or removing the photo may delete it.

export const CATEGORY_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const CATEGORY_PHOTO_MAX_PX = 1200;
export const CATEGORY_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

const CATEGORY_PHOTO_URL = /^\/uploads\/category-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

export class CategoryPhotoError extends Error {}

/** A stored category photo URL (what POST /api/categories/photo returns). */
export function isCategoryPhotoUrl(url: string): boolean {
  return CATEGORY_PHOTO_URL.test(url);
}

/** Re-encodes an uploaded image: orientation applied, ≤1200 px, WebP, no metadata. */
export async function processCategoryPhoto(input: Buffer): Promise<Buffer> {
  try {
    return await sharp(input, { failOn: "error" })
      .rotate()
      .resize(CATEGORY_PHOTO_MAX_PX, CATEGORY_PHOTO_MAX_PX, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new CategoryPhotoError("That file is not a readable JPEG, PNG or WebP image");
  }
}

/** Processes and stores an upload; returns the URL to put on the category. */
export async function saveCategoryPhoto(input: Buffer): Promise<string> {
  const webp = await processCategoryPhoto(input);
  return saveUpload(`category-${randomUUID()}.webp`, webp);
}

/** Refuses a photoUrl that this app didn't write as a category photo. */
export function assertCategoryPhotoUrl(url: string): void {
  const file = isCategoryPhotoUrl(url) ? uploadUrlPath(url) : null;
  if (!file || !existsSync(file)) {
    throw new CategoryPhotoError("Upload the photo again — that file isn't a category photo");
  }
}

/**
 * Verify R3 — a category photo belongs to one category: the file is deleted
 * when that category replaces or drops it, so another category may not point
 * at it (a crafted request would otherwise get someone else's file deleted).
 */
export async function assertCategoryPhotoUnused(
  db: { category: { findFirst(args: { where: { photoUrl: string; NOT?: { id: number } }; select: { id: true } }): Promise<{ id: number } | null> } },
  url: string,
  selfId: number | null
): Promise<void> {
  const other = await db.category.findFirst({
    where: { photoUrl: url, ...(selfId != null ? { NOT: { id: selfId } } : {}) },
    select: { id: true },
  });
  if (other) throw new CategoryPhotoError("Upload the photo again — that file belongs to another category");
}

/** Deletes a category photo's file (only ever a category-<uuid>.webp). */
export async function deleteCategoryPhoto(url: string | null | undefined): Promise<void> {
  if (!url || !isCategoryPhotoUrl(url)) return;
  const file = uploadUrlPath(url);
  if (!file) return;
  try {
    await unlink(file);
  } catch {
    // already gone
  }
}

/** The audit action for a photo change, or null when it didn't change. */
export function categoryPhotoAction(
  before: string | null,
  after: string | null
): "category.photo.add" | "category.photo.replace" | "category.photo.remove" | null {
  if (before === after) return null;
  if (!before) return "category.photo.add";
  if (!after) return "category.photo.remove";
  return "category.photo.replace";
}
