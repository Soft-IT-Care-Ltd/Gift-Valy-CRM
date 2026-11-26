// Generates every logo-derived file from the two brand masters.
// Rerun after a logo change: npx tsx scripts/generate-brand-assets.ts
//
// Masters (navy + orange ink on a transparent background):
//   public/gift-valy-logo.png       the wordmark "Gift Valy" (also served as is)
//   scripts/brand/gift-valy-mark.png the square-ish mark: "Gi" with the orange
//                                    diamond — for icons, where the wide
//                                    wordmark would be too small to read
//
// Writes:
//   public/gift-valy-logo-dark.png  the wordmark for dark mode (navy ink → white)
//   public/shop/logo.png            the website header's wordmark (smaller file)
//   public/shop/icon.png            the website's icon (tab, home screen, 404,
//                                   banner placeholder)
//   public/icons/*                  the ERP's PWA + iOS home-screen icons
//   app/favicon.ico                 the ERP's browser-tab icon (16/32/48)
//
// public/shop/og.png (the 1200 × 630 link preview) carries text, so it is not
// made here — swap the logo in it by hand. public/shop/placeholder.png (the gift
// box on item cards without a photo) is not made here either: the owner kept
// the earlier logo's gift box there.

import path from "path";
import { mkdir, writeFile } from "fs/promises";
import sharp from "sharp";

const ROOT = process.cwd();
const WORDMARK = path.join(ROOT, "public", "gift-valy-logo.png");
const MARK = path.join(ROOT, "scripts", "brand", "gift-valy-mark.png");
const WHITE = "#ffffff";

/** The mark centred on a white square, `ratio` of the side wide. */
async function squareIcon(size: number, ratio: number): Promise<Buffer> {
  const mark = await sharp(MARK).resize({ width: Math.round(size * ratio) }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: mark, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function write(rel: string, data: Buffer) {
  const file = path.join(ROOT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  const { width, height } = await sharp(data).metadata().catch(() => ({ width: 0, height: 0 }));
  console.log(`  ${rel}${width ? ` (${width}×${height})` : ""}`);
}

/** Navy ink (blue over red) turns white; the orange stays. Alpha is kept. */
async function darkWordmark(): Promise<Buffer> {
  const { data, info } = await sharp(WORDMARK).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 2] > data[i]) data[i] = data[i + 1] = data[i + 2] = 255;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** An .ico holding PNG images (every current browser reads PNG-in-ICO). */
function ico(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, n) => {
    const e = 6 + 16 * n;
    header.writeUInt8(size >= 256 ? 0 : size, e); // width (0 = 256)
    header.writeUInt8(size >= 256 ? 0 : size, e + 1); // height
    header.writeUInt8(0, e + 2); // palette size
    header.writeUInt8(0, e + 3); // reserved
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

async function main() {
  console.log("Generating brand assets:");
  await write("public/gift-valy-logo-dark.png", await darkWordmark());
  await write(
    "public/shop/logo.png",
    await sharp(WORDMARK).resize({ height: 150 }).png({ compressionLevel: 9 }).toBuffer(),
  );
  await write("public/shop/icon.png", await squareIcon(512, 0.72));
  await write("public/icons/icon-192.png", await squareIcon(192, 0.7));
  await write("public/icons/icon-512.png", await squareIcon(512, 0.7));
  await write("public/icons/icon-maskable-512.png", await squareIcon(512, 0.56)); // inside the mask safe zone
  await write("public/icons/apple-touch-icon.png", await squareIcon(180, 0.7)); // iOS home screen
  const tab = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await squareIcon(size, 0.9) })));
  await write("app/favicon.ico", ico(tab));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
