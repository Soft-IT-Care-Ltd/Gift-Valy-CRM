// PHOTO_PRINT.md PP-6 — the print PDF. No DB. Run: npm run test:print
//   - the plan: for both layouts and the full 10 + 4 + 2 kit, every piece at
//     its exact mm size and position, inside A4, never closer than the gap to
//     another piece or the info box, each piece exactly once, exact 300 DPI px
//   - the real PDF: parsed back, every page exactly A4 and every image drawn at
//     the planned mm (± 0.001) from an image of exactly the planned pixels
//   - partial kits drop empty pages; two kits each start on a new page
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  A4_MM,
  DEFAULT_PRINT_SIZES,
  PRINT_LAYOUTS,
  PRINT_LAYOUT_IDS,
  slotPixels,
  type LayoutPiece,
  type PrintLayout,
  type PrintSizes,
} from "../lib/print-layouts";
import {
  A4_PT,
  PT_PER_MM,
  PrintPlanError,
  planPrintPages,
  type KitForPrint,
  type PlannedPage,
} from "../lib/print-pdf-plan";
import { PrintPdfError, renderPrintPdf } from "../lib/print-pdf";

const INFO = { orderNo: "GV-2610-0001", recipientName: "রহিম", recipientPhone: "01711000000", delivery: "25 Oct 2026" };

function fullKit(tag = "k"): KitForPrint {
  return {
    photos: [
      ...Array.from({ length: 10 }, (_, i) => ({ slot: "PHOTO_L" as const, position: i + 1, file: `${tag}-L${i + 1}` })),
      ...Array.from({ length: 4 }, (_, i) => ({ slot: "PHOTO_S" as const, position: i + 1, file: `${tag}-S${i + 1}` })),
    ],
    cards: [
      { slot: "CARD_1", file: `${tag}-C1` },
      { slot: "CARD_2", file: `${tag}-C2` },
    ],
  };
}

const EPS = 1e-9;

/** All the geometry rules for one planned page. */
function assertPageGeometry(page: PlannedPage, layout: PrintLayout, sizes: PrintSizes) {
  const lp = layout.pages.find((p) => p.info === page.info.box);
  assert.ok(lp, "info box is the layout's");
  for (const img of page.images) {
    const piece: LayoutPiece | undefined = lp!.pieces.find((p) => p.slot === img.slot && p.n === img.n);
    assert.ok(piece, `${img.slot} ${img.n} is on this layout page`);
    assert.equal(img.xMm, piece!.x, "x exactly the layout's");
    assert.equal(img.yMm, piece!.y, "y exactly the layout's");
    assert.equal(img.wMm, sizes[img.slot].w, "width exactly the size setting");
    assert.equal(img.hMm, sizes[img.slot].h, "height exactly the size setting");
    assert.deepEqual(img.px, slotPixels(sizes[img.slot]), "300 DPI pixels");
  }
  const boxes = [
    ...page.images.map((i) => ({ name: `${i.slot} ${i.n}`, x: i.xMm, y: i.yMm, w: i.wMm, h: i.hMm })),
    { name: "info", ...page.info.box },
  ];
  for (const b of boxes) {
    assert.ok(b.x >= -EPS && b.y >= -EPS, `${b.name} inside the page (top/left)`);
    assert.ok(b.x + b.w <= A4_MM.w + EPS && b.y + b.h <= A4_MM.h + EPS, `${b.name} inside the page (bottom/right)`);
  }
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const A = boxes[a];
      const B = boxes[b];
      const apart = Math.max(B.x - (A.x + A.w), A.x - (B.x + B.w), B.y - (A.y + A.h), A.y - (B.y + B.h));
      assert.ok(apart >= layout.gap - 0.001, `${A.name} / ${B.name}: ${apart.toFixed(2)} mm apart, gap ${layout.gap}`);
    }
  }
}

describe("PP-6 plan: kit + layout → pages", () => {
  for (const id of PRINT_LAYOUT_IDS) {
    const layout = PRINT_LAYOUTS[id];
    test(`${id}: every piece exact, inside A4, never closer than the gap`, () => {
      const pages = planPrintPages([fullKit()], layout, DEFAULT_PRINT_SIZES, INFO);
      assert.equal(pages.length, layout.pages.length);
      for (const page of pages) assertPageGeometry(page, layout, DEFAULT_PRINT_SIZES);
      const placed = pages.flatMap((p) => p.images.map((i) => i.file)).sort();
      assert.deepEqual(placed, [...fullKit().photos.map((p) => p.file), "k-C1", "k-C2"].sort(), "each piece once");
      assert.deepEqual(pages.map((p) => p.info.pageLabel), pages.map((_, i) => `Page ${i + 1} of ${pages.length}`));
    });
  }

  test("2 pages borderless, 3 pages safe", () => {
    assert.equal(planPrintPages([fullKit()], PRINT_LAYOUTS.BORDERLESS_2, DEFAULT_PRINT_SIZES, INFO).length, 2);
    assert.equal(planPrintPages([fullKit()], PRINT_LAYOUTS.SAFE_3, DEFAULT_PRINT_SIZES, INFO).length, 3);
  });

  test("a size that breaks the layout is refused, never scaled", () => {
    const sizes = { ...DEFAULT_PRINT_SIZES, PHOTO_L: { w: 80, h: 77.6 } };
    assert.throws(() => planPrintPages([fullKit()], PRINT_LAYOUTS.SAFE_3, sizes, INFO), PrintPlanError);
  });

  test("a kit without cards skips the card page; empty slots stay blank", () => {
    const kit = fullKit();
    kit.cards = [];
    kit.photos = kit.photos.filter((p) => p.slot === "PHOTO_S" || p.position <= 6);
    const pages = planPrintPages([kit], PRINT_LAYOUTS.SAFE_3, DEFAULT_PRINT_SIZES, INFO);
    assert.equal(pages.length, 1, "page 2 (Big 7–10 + Card 2) and page 3 (Card 1) have nothing");
    assert.equal(pages[0].images.length, 10);
    assert.equal(pages[0].info.pageLabel, "Page 1 of 1");
  });

  test("two kits: each starts on a new page, pages counted per kit", () => {
    const pages = planPrintPages([fullKit("a"), fullKit("b")], PRINT_LAYOUTS.BORDERLESS_2, DEFAULT_PRINT_SIZES, INFO);
    assert.equal(pages.length, 4);
    assert.deepEqual(pages.map((p) => p.info.pageLabel), [
      "Kit 1 of 2 · Page 1 of 2",
      "Kit 1 of 2 · Page 2 of 2",
      "Kit 2 of 2 · Page 1 of 2",
      "Kit 2 of 2 · Page 2 of 2",
    ]);
    assert.ok(pages.slice(0, 2).every((p) => p.images.every((i) => i.file.startsWith("a-"))));
    assert.ok(pages.slice(2).every((p) => p.images.every((i) => i.file.startsWith("b-"))));
  });

  test("a photo with no place in the layout is refused", () => {
    const kit = fullKit();
    kit.photos.push({ slot: "PHOTO_S", position: 5, file: "x" });
    assert.throws(() => planPrintPages([kit], PRINT_LAYOUTS.SAFE_3, DEFAULT_PRINT_SIZES, INFO), PrintPlanError);
  });
});

// ---------- the real PDF, parsed back ----------

const images = new Map<string, Buffer>();
const infoPng = () => sharp({ create: { width: 40, height: 30, channels: 4, background: "#00000000" } }).png().toBuffer();

async function exactImage(slot: keyof PrintSizes, color: string): Promise<Buffer> {
  const px = slotPixels(DEFAULT_PRINT_SIZES[slot]);
  const img = sharp({ create: { width: px.w, height: px.h, channels: 3, background: color } });
  return slot.startsWith("CARD") ? img.png().toBuffer() : img.jpeg({ quality: 92 }).toBuffer();
}

before(async () => {
  for (const p of fullKit().photos) images.set(p.file, await exactImage(p.slot, "#3366aa"));
  images.set("k-C1", await exactImage("CARD_1", "#ffeeee"));
  images.set("k-C2", await exactImage("CARD_2", "#eeffee"));
});

interface DrawnImage {
  name: string;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}

/** Pages of an uncompressed pdfkit PDF: MediaBox and every image drawn. */
function parsePdf(pdf: Buffer) {
  const s = pdf.toString("latin1");
  const objects = new Map<number, string>();
  for (const m of s.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)) objects.set(Number(m[1]), m[2]);
  const xobjects = new Map<number, { w: number; h: number }>();
  for (const [n, body] of objects) {
    if (/\/Subtype \/Image/.test(body)) {
      const w = /\/Width (\d+)/.exec(body);
      const h = /\/Height (\d+)/.exec(body);
      if (w && h) xobjects.set(n, { w: Number(w[1]), h: Number(h[1]) });
    }
  }
  const pages = [...objects.values()]
    .filter((b) => /\/Type \/Page\b/.test(b))
    .map((b) => {
      const media = /\/MediaBox \[([^\]]+)\]/.exec(b)![1].trim().split(/\s+/).map(Number);
      const contentRef = Number(/\/Contents (\d+) 0 R/.exec(b)![1]);
      const content = objects.get(contentRef)!;
      // Resource name → object number (/I1 12 0 R).
      const res = new Map<string, number>();
      const resObj = /\/Resources (\d+) 0 R/.exec(b);
      const resBody = resObj ? objects.get(Number(resObj[1]))! : b;
      const xo = /\/XObject <<([\s\S]*?)>>/.exec(resBody);
      if (xo) for (const m of xo[1].matchAll(/\/(\w+) (\d+) 0 R/g)) res.set(m[1], Number(m[2]));
      const drawn: (DrawnImage & { px: { w: number; h: number } | undefined })[] = [];
      // pdfkit: "1 0 0 -1 0 H cm" flips the page once; an image is then
      // "w 0 0 -h x y+h cm /In Do" in top-left-origin points.
      for (const m of content.matchAll(/([\d.-]+) 0 0 ([\d.-]+) ([\d.-]+) ([\d.-]+) cm\n\/(\w+) Do/g)) {
        const [w, negH, x, yh] = [m[1], m[2], m[3], m[4]].map(Number);
        drawn.push({
          name: m[5],
          xMm: x / PT_PER_MM,
          yMm: (yh + negH) / PT_PER_MM,
          wMm: w / PT_PER_MM,
          hMm: -negH / PT_PER_MM,
          px: xobjects.get(res.get(m[5]) ?? -1),
        });
      }
      return { media, flip: content.includes(`1 0 0 -1 0 ${A4_PT.h} cm`), drawn };
    });
  return pages;
}

describe("PP-6 the PDF itself", () => {
  for (const id of PRINT_LAYOUT_IDS) {
    test(`${id}: exactly A4, every image at its planned mm from exact 300 DPI pixels`, async () => {
      const plan = planPrintPages([fullKit()], PRINT_LAYOUTS[id], DEFAULT_PRINT_SIZES, INFO);
      const pdf = await renderPrintPdf(
        plan,
        { readImage: async (f) => images.get(f)!, renderInfo: infoPng },
        { compress: false }
      );
      const pages = parsePdf(pdf);
      assert.equal(pages.length, plan.length);
      pages.forEach((page, i) => {
        assert.deepEqual(page.media, [0, 0, A4_PT.w, A4_PT.h], "MediaBox exactly A4");
        assert.ok(page.flip, "one page-sized flip, no other page transform");
        const pieces = page.drawn.slice(0, plan[i].images.length);
        assert.equal(page.drawn.length, plan[i].images.length + 1, "the pieces + the info text");
        plan[i].images.forEach((want, j) => {
          const got = pieces[j];
          for (const k of ["xMm", "yMm", "wMm", "hMm"] as const) {
            assert.ok(Math.abs(got[k] - want[k]) < 0.001, `page ${i + 1} ${want.slot} ${want.n} ${k}: ${got[k]} vs ${want[k]}`);
          }
          assert.deepEqual(got.px, want.px, `${want.slot} ${want.n} embedded at exactly ${want.px.w}×${want.px.h} px`);
        });
        // The info text sits inside its dashed box.
        const info = page.drawn[page.drawn.length - 1];
        const box = plan[i].info.box;
        assert.ok(info.xMm >= box.x && info.yMm >= box.y && info.xMm + info.wMm <= box.x + box.w && info.yMm + info.hMm <= box.y + box.h);
      });
    });
  }

  test("an image that is not exactly the slot's pixels is refused", async () => {
    const plan = planPrintPages([fullKit()], PRINT_LAYOUTS.SAFE_3, DEFAULT_PRINT_SIZES, INFO);
    const wrong = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#000" } }).jpeg().toBuffer();
    await assert.rejects(
      renderPrintPdf(plan, { readImage: async () => wrong, renderInfo: infoPng }),
      PrintPdfError
    );
  });
});
