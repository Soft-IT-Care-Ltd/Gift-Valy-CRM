import PDFDocument from "pdfkit";
import sharp from "sharp";
import { DEFAULT_CARD_FONT } from "./print-card";
import { mmToPx } from "./print-layouts";
import { A4_PT, PT_PER_MM, type PlannedInfo, type PlannedPage } from "./print-pdf-plan";

// ============ PHOTO_PRINT.md PP-6 — the planned pages → the print PDF ============
//
// Exactly A4 (595.28 × 841.89 pt), margin 0. Every image goes in at its
// planned mm position and size — the page is never scaled and an image whose
// pixels are not exactly the slot's 300 DPI size is refused (the caller
// rebuilds it first), so the printer gets 300 DPI with no resampling.
// A 0.25 pt light-grey hairline on each piece's exact edge is the cutting line;
// the info box has a dashed outline. Its text goes through sharp/Pango (like
// the cards): pdfkit's shaper breaks Bangla conjuncts in recipient names.

export interface PdfDeps {
  /** The image file's bytes (JPEG photo / PNG card). */
  readImage(file: string): Promise<Buffer>;
  /** The info box text as a PNG of at most w × h pixels (300 DPI). */
  renderInfo(info: PlannedInfo, w: number, h: number): Promise<Buffer>;
}

const mm = (v: number) => v * PT_PER_MM;
const CUT_LINE = "#c8c8c8";
/** Space between the info box's dashed outline and its text. */
const INFO_PAD_MM = 1.5;

export class PrintPdfError extends Error {}

export async function renderPrintPdf(pages: PlannedPage[], deps: PdfDeps, opts: { compress?: boolean } = {}): Promise<Buffer> {
  if (pages.length === 0) throw new PrintPdfError("Nothing to print");
  const doc = new PDFDocument({
    size: [A4_PT.w, A4_PT.h],
    margin: 0,
    autoFirstPage: false,
    compress: opts.compress ?? true,
    info: { Title: `${pages[0].info.orderNo} — photos & cards`, Producer: "Gift Valy" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  for (const page of pages) {
    doc.addPage({ size: [A4_PT.w, A4_PT.h], margin: 0 });
    for (const img of page.images) {
      const data = await deps.readImage(img.file);
      const meta = await sharp(data).metadata();
      if (meta.width !== img.px.w || meta.height !== img.px.h) {
        throw new PrintPdfError(
          `${img.slot} ${img.n} is ${meta.width}×${meta.height} px, needs exactly ${img.px.w}×${img.px.h}`
        );
      }
      doc.image(data, mm(img.xMm), mm(img.yMm), { width: mm(img.wMm), height: mm(img.hMm) });
    }
    // Cutting lines on the exact edges (after the images, so none is covered).
    doc.save().lineWidth(0.25).strokeColor(CUT_LINE).undash();
    for (const img of page.images) {
      doc.rect(mm(img.xMm), mm(img.yMm), mm(img.wMm), mm(img.hMm)).stroke();
    }
    doc.restore();

    const box = page.info.box;
    doc
      .save()
      .lineWidth(0.5)
      .strokeColor("#888888")
      .dash(3, { space: 2 })
      .rect(mm(box.x), mm(box.y), mm(box.w), mm(box.h))
      .stroke()
      .undash()
      .restore();
    const innerW = box.w - 2 * INFO_PAD_MM;
    const innerH = box.h - 2 * INFO_PAD_MM;
    const png = await deps.renderInfo(page.info, mmToPx(innerW), mmToPx(innerH));
    const pm = await sharp(png).metadata();
    // At 300 DPI: px → mm, top-left inside the padding.
    doc.image(png, mm(box.x + INFO_PAD_MM), mm(box.y + INFO_PAD_MM), {
      width: mm(((pm.width ?? 1) * 25.4) / 300),
      height: mm(((pm.height ?? 1) * 25.4) / 300),
    });
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

// ---------- the info box text (sharp / Pango, 300 DPI) ----------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const BIG = 1.45;

function pangoText(markup: string, pt: number, font: string, widthPx?: number) {
  return sharp({
    text: {
      text: markup,
      font: `Noto Sans Bengali ${pt}`,
      fontfile: font,
      ...(widthPx ? { width: widthPx } : {}),
      dpi: 300,
      rgba: true,
      wrap: "word-char",
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
}

/** The order number on its own line (never wrapped), the rest below it. */
async function infoAt(info: PlannedInfo, pt: number, w: number, font: string) {
  const no = await pangoText(`<span size="${Math.round(pt * BIG * 1024)}" weight="bold">${esc(info.orderNo)}</span>`, pt, font);
  const rest = await pangoText(
    [
      esc(info.recipientName),
      esc(info.recipientPhone),
      `Delivery: ${esc(info.delivery)}`,
      `<span foreground="#555555">${esc(info.pageLabel)}</span>`,
    ].join("\n"),
    pt,
    font,
    w
  );
  const gap = Math.round((pt * 300) / 72 / 4);
  return {
    no,
    rest,
    gap,
    width: Math.max(no.info.width, rest.info.width),
    height: no.info.height + gap + rest.info.height,
  };
}

/** The info box text at the largest size (5–11 pt) that fits w × h px with
 *  the order number on ONE line (Packing reads it at a glance). */
export async function renderInfoText(info: PlannedInfo, w: number, h: number): Promise<Buffer> {
  const font = DEFAULT_CARD_FONT.replace("-Bold", "-Regular");
  let best = await infoAt(info, 5, w, font);
  for (let pt = 11; pt > 5; pt -= 0.5) {
    const r = await infoAt(info, pt, w, font);
    if (r.width <= w && r.height <= h) {
      best = r;
      break;
    }
  }
  // Never larger than the box: a very long name at 5 pt is cut, not spilled.
  const W = Math.min(w, best.width);
  const H = Math.min(h, best.height);
  const crop = async (img: { data: Buffer; info: { width: number; height: number } }, maxH: number) =>
    img.info.width <= W && img.info.height <= maxH
      ? img.data
      : sharp(img.data)
          .extract({ left: 0, top: 0, width: Math.min(W, img.info.width), height: Math.max(1, Math.min(maxH, img.info.height)) })
          .png()
          .toBuffer();
  const layers = [{ input: await crop(best.no, H), left: 0, top: 0 }];
  const restTop = best.no.info.height + best.gap;
  if (restTop < H) layers.push({ input: await crop(best.rest, H - restTop), left: 0, top: restTop });
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png()
    .toBuffer();
}
