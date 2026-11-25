import { existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { uploadRoot } from "@/lib/file-storage";

// ROUND3 W-3 — website photo sizes. /img/<base>-<360|720|1080>.webp is made
// from the stored upload once (EXIF orientation applied, metadata dropped,
// never enlarged, WebP) and kept in UPLOAD_DIR/web-cache. A new photo has a
// new name, so a size never changes: browsers and Cloudflare may keep it a
// year. Whether a photo may be served at all is lib/storefront/catalog.ts's
// call (publicPhotoFile), made on every request.

export const WEB_IMAGE_WIDTHS = [360, 720, 1080] as const;
/** ROUND3 W-7 — home page banners (banner-<uuid>): wide desktop photos need a bigger size, resized by width only. */
export const BANNER_WIDTHS = [720, 1080, 1600] as const;
export type WebImageWidth = (typeof WEB_IMAGE_WIDTHS)[number] | (typeof BANNER_WIDTHS)[number];

export const isBannerBase = (base: string) => base.startsWith("banner-");

/** "<base>-720.webp" → { base, width }, or null. 1600 is a banner size only. */
export function parseWebImageName(file: string): { base: string; width: WebImageWidth } | null {
  const m = /^([A-Za-z0-9][A-Za-z0-9-]{0,127})-(360|720|1080|1600)\.webp$/.exec(file);
  if (!m) return null;
  const width = Number(m[2]) as WebImageWidth;
  if (width === 1600 && !isBannerBase(m[1])) return null;
  return { base: m[1], width };
}

/** The resized WebP for an original upload (made once, then read from the cache). */
export async function webImageBytes(original: string, base: string, width: WebImageWidth): Promise<Buffer> {
  const dir = path.join(/* turbopackIgnore: true */ uploadRoot(), "web-cache");
  const cached = path.join(dir, `${base}-${width}.webp`);
  if (existsSync(cached) && (await stat(cached)).mtimeMs >= (await stat(original)).mtimeMs) {
    return readFile(cached);
  }
  const out = await sharp(original, { failOn: "error" })
    .rotate()
    .resize(isBannerBase(base) ? { width, withoutEnlargement: true } : { width, height: width, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  await mkdir(dir, { recursive: true });
  const tmp = `${cached}.${process.pid}.tmp`;
  await writeFile(tmp, out);
  await rename(tmp, cached);
  return out;
}
