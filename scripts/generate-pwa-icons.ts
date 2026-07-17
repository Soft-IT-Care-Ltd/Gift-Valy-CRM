// Generates the PWA icon set in public/icons/ from public/gift-valy-logo.png.
// Rerun after a logo change: npx tsx scripts/generate-pwa-icons.ts
//
// The logo is wide (815×246), so each icon is a white square canvas with the
// logo centered. The maskable icon keeps the logo inside the ~80% safe zone so
// Android's circular/squircle masks never clip it.

import path from "path";
import { mkdir } from "fs/promises";
import sharp from "sharp";

const LOGO = path.join(process.cwd(), "public", "gift-valy-logo.png");
const OUT_DIR = path.join(process.cwd(), "public", "icons");
const BG = "#ffffff";

async function makeIcon(size: number, logoWidthRatio: number, file: string) {
  const logo = await sharp(LOGO)
    .resize({ width: Math.round(size * logoWidthRatio) })
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(path.join(OUT_DIR, file));
  console.log(`  ${file} (${size}×${size})`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log("Generating PWA icons:");
  await makeIcon(192, 0.82, "icon-192.png");
  await makeIcon(512, 0.82, "icon-512.png");
  await makeIcon(512, 0.62, "icon-maskable-512.png"); // safe-zone for masks
  await makeIcon(180, 0.82, "apple-touch-icon.png"); // iOS home screen
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
