// PHOTO_PRINT.md PP-3 — `npm run db:seed-card-designs`: adds the six starter
// card designs (lib/card-design-seed.ts) for Card 1 and Card 2, each with its
// background drawn at the shop's current card size (300 DPI) and saved to
// UPLOAD_DIR like an uploaded background. Safe on production and staging — it
// writes card_designs + their background files only (never orders, never
// order_sequences; CLAUDE.md rule 6) and only ADDS: a design whose name already
// exists for that card is skipped, so an Admin's edits and deactivations
// survive and a second run adds nothing.
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { prisma } from "../lib/db";
import { saveUpload } from "../lib/file-storage";
import { getPrintSettings } from "../lib/settings";
import { slotPixels, type CardSlot } from "../lib/print-layouts";
import { SEED_CARD_DESIGNS, cardDesignSvg } from "../lib/card-design-seed";

async function main() {
  const { sizes } = await getPrintSettings();
  let added = 0;
  let skipped = 0;
  for (const slot of ["CARD_1", "CARD_2"] as CardSlot[]) {
    const px = slotPixels(sizes[slot]);
    for (const d of SEED_CARD_DESIGNS) {
      const exists = await prisma.cardDesign.findFirst({ where: { slot, name: d.name }, select: { id: true } });
      if (exists) {
        skipped++;
        continue;
      }
      // The same treatment as an uploaded background (exact pixels, sRGB JPEG).
      const jpg = await sharp(Buffer.from(cardDesignSvg(d, px.w, px.h)))
        .resize(px.w, px.h, { fit: "fill" })
        .toColourspace("srgb")
        .withMetadata({ density: 300 })
        .jpeg({ quality: 95 })
        .toBuffer();
      const backgroundPath = await saveUpload(`card-bg-${randomUUID()}.jpg`, jpg);
      await prisma.cardDesign.create({
        data: {
          name: d.name,
          slot,
          backgroundPath,
          textBox: { ...d.textBox },
          textColor: d.textColor,
          align: "CENTER",
          fontPath: null,
          maxFontPt: d.maxFontPt,
          minFontPt: d.minFontPt,
          isActive: true,
        },
      });
      added++;
    }
  }
  console.log(
    `Card designs: ${added} added, ${skipped} already there (${SEED_CARD_DESIGNS.length} designs × 2 cards in the seed).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
