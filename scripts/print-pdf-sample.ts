// PHOTO_PRINT.md PP-6 — renders a sample print PDF from made-up test photos at
// every layout, through the real code paths (storeOriginal → makePrintFile,
// renderCard, planPrintPages → renderPrintPdf with the Pango info box). No DB.
//
//   UPLOAD_DIR=/tmp/pp-uploads npx tsx scripts/print-pdf-sample.ts <out-dir>
//
// Run it on Linux (Docker node:24-bookworm-slim): on macOS sharp's Pango
// ignores the font file, so Bangla only looks right on the server's OS.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { DEFAULT_PRINT_SIZES, PRINT_LAYOUT_IDS, PRINT_LAYOUTS } from "../lib/print-layouts";
import { makePrintFile, storeOriginal } from "../lib/print-photos";
import { renderCard } from "../lib/print-card";
import { cardLines } from "../lib/print-card-text";
import { savePrintFile, saveUpload } from "../lib/file-storage";
import { planPrintPages, type KitForPrint } from "../lib/print-pdf-plan";
import { renderInfoText, renderPrintPdf } from "../lib/print-pdf";
import { printFilePath } from "../lib/file-storage";
import { readFile } from "node:fs/promises";

const out = process.argv[2] ?? "./storage/print-sample";

/** A test "photo": gradient, a face-like circle off-centre, a big label. */
function testPhoto(label: string, w: number, h: number, hue: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},70%,75%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,40%)"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${w * 0.62}" cy="${h * 0.4}" r="${Math.min(w, h) * 0.18}" fill="#ffe0bd" stroke="#333" stroke-width="${Math.min(w, h) * 0.01}"/>
    <text x="50%" y="88%" text-anchor="middle" font-family="sans-serif" font-weight="bold"
      font-size="${Math.min(w, h) * 0.14}" fill="#fff">${label}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

async function main() {
  await mkdir(out, { recursive: true });
  const sizes = DEFAULT_PRINT_SIZES;
  const shapes = [
    [3000, 4000],
    [4000, 3000],
    [2400, 2400],
    [1080, 1920],
  ];

  const kit: KitForPrint = { photos: [], cards: [] };
  for (const [slot, count] of [["PHOTO_L", 10], ["PHOTO_S", 4]] as const) {
    for (let n = 1; n <= count; n++) {
      const [w, h] = shapes[(n - 1) % shapes.length];
      const label = `${slot === "PHOTO_L" ? "Big" : "Small"} ${n}`;
      const stored = await storeOriginal(await testPhoto(label, w, h, (n * 37) % 360));
      const made = await makePrintFile(stored, slot, sizes);
      kit.photos.push({ slot, position: n, file: made.printPath });
    }
  }

  // A pink-framed background for both cards, so the card's edge shows.
  const bg = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1500">
      <rect width="100%" height="100%" fill="#fff5f8"/>
      <rect x="40" y="40" width="1420" height="1420" fill="none" stroke="#e7a3bd" stroke-width="18" rx="40"/>
    </svg>`)
  )
    .png()
    .toBuffer();
  const backgroundPath = await saveUpload("pp-sample-card-bg.png", bg);
  const design = {
    backgroundPath,
    textBox: { x: 12, y: 15, w: 76, h: 70 },
    textColor: "#be185d",
    align: "CENTER" as const,
    fontPath: null,
    maxFontPt: 16,
    minFontPt: 9,
  };
  const messages = {
    CARD_1: "প্রিয় {to}, আজ পৃথিবীতে তোমার আসার দিন — আমার জীবনের সবচেয়ে সুন্দর দিন। শ্রদ্ধা আর ভালোবাসা। শুভ জন্মদিন! — তোমার {from}",
    CARD_2: "Happy Birthday, {to}! তোমার হাসিটাই আমার সবচেয়ে প্রিয় উপহার। Stay happy forever. — {from}",
  } as const;
  for (const slot of ["CARD_1", "CARD_2"] as const) {
    const card = await renderCard(design, sizes[slot], cardLines(messages[slot], { to: "নুসরাত", from: "রাকিব" }));
    kit.cards.push({ slot, file: await savePrintFile(`card-sample-${slot === "CARD_1" ? 1 : 2}.png`, card.png) });
  }

  const info = {
    orderNo: "SAMPLE-2610-0042",
    recipientName: "নুসরাত জাহান (Nusrat)",
    recipientPhone: "01711-234567",
    delivery: "28 Oct 2026",
  };
  for (const id of PRINT_LAYOUT_IDS) {
    const pages = planPrintPages([kit], PRINT_LAYOUTS[id], sizes, info);
    const pdf = await renderPrintPdf(pages, {
      readImage: (name) => readFile(printFilePath(name)!),
      renderInfo: renderInfoText,
    });
    const file = path.join(out, `sample-${id}.pdf`);
    await writeFile(file, pdf);
    console.log(`${file}: ${pages.length} pages, ${pdf.length} bytes`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
