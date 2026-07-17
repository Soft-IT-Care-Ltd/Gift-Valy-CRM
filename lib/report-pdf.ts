import path from "path";
import PDFDocument from "pdfkit";

// ============ SPEC §12 — report PDF export (all reports: "export CSV + PDF") ============
// Generic tabular report renderer. The CLIENT builds the payload from the same
// role-scoped data it already renders on screen (mirroring the CSV exports), so
// paper always equals screen and no report/scope logic is duplicated here. The
// renderer itself adds no data — it can only print what the caller may see.
// Same Noto Sans Bengali setup as the invoice PDF so Bangla names render.

export interface ReportPdfKpi {
  label: string;
  value: string;
}

export interface ReportPdfSection {
  heading?: string;
  note?: string; // small print under the heading (definitions, caveats)
  headers: string[];
  // "r" right-aligns a column (numbers); default left. Index-matched to headers.
  aligns?: ("l" | "r")[];
  rows: (string | number | null)[][];
}

export interface ReportPdfPayload {
  title: string;
  subtitle?: string; // usually the date range + active filters
  landscape?: boolean; // wide tables (many columns) read better rotated
  kpis?: ReportPdfKpi[];
  sections: ReportPdfSection[];
}

const FONT_DIR = path.join(process.cwd(), "public", "fonts");
const FONT_REGULAR = path.join(FONT_DIR, "NotoSansBengali-Regular.ttf");
const FONT_BOLD = path.join(FONT_DIR, "NotoSansBengali-Bold.ttf");

// Palette matches lib/invoice.ts so all company paper looks related.
const INK = "#111827";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";
const ZEBRA = "#f8fafc";
const BRAND = "#be185d";
const HEADER_FILL = "#1f2937";

const MARGIN = 40;
const A4_W = 595.28;
const A4_H = 841.89;

const CELL_PAD_X = 5;
const CELL_PAD_Y = 4;
const TABLE_FONT = 8;
const HEAD_FONT = 8;

function dhakaNow(): string {
  return new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Doc = PDFKit.PDFDocument;

export function renderReportPdf(
  payload: ReportPdfPayload,
  meta: { generatedBy: string }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pageW = payload.landscape ? A4_H : A4_W;
    const pageH = payload.landscape ? A4_W : A4_H;
    const contentW = pageW - MARGIN * 2;
    // Reserve a footer strip; flowing content stops above it.
    const bottom = pageH - MARGIN - 14;

    const doc = new PDFDocument({
      size: "A4",
      layout: payload.landscape ? "landscape" : "portrait",
      margin: MARGIN,
      font: FONT_REGULAR,
      bufferPages: true, // so page numbers can be stamped at the end
      info: { Title: payload.title, Author: "Gift Valy" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.registerFont("bn", FONT_REGULAR);
    doc.registerFont("bn-b", FONT_BOLD);

    let y = MARGIN;
    const newPage = () => {
      doc.addPage();
      y = MARGIN;
    };

    // ---------- header ----------
    doc.font("bn-b").fontSize(16).fillColor(BRAND).text("Gift Valy", MARGIN, y);
    doc
      .font("bn-b")
      .fontSize(13)
      .fillColor(INK)
      .text(payload.title, MARGIN, y + 2, { width: contentW, align: "right" });
    y += 22;
    if (payload.subtitle) {
      doc
        .font("bn")
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(payload.subtitle, MARGIN, y, { width: contentW, align: "right" });
      y += doc.heightOfString(payload.subtitle, { width: contentW }) + 4;
    }
    doc.moveTo(MARGIN, y).lineTo(pageW - MARGIN, y).lineWidth(1).stroke(BORDER);
    y += 10;

    // ---------- KPI chips ----------
    if (payload.kpis && payload.kpis.length > 0) {
      const gap = 8;
      const perRow = Math.min(payload.kpis.length, payload.landscape ? 6 : 4);
      const chipW = (contentW - gap * (perRow - 1)) / perRow;
      const chipH = 34;
      payload.kpis.forEach((k, i) => {
        const col = i % perRow;
        if (col === 0 && i > 0) y += chipH + gap;
        if (y + chipH > bottom) newPage();
        const x = MARGIN + col * (chipW + gap);
        doc.roundedRect(x, y, chipW, chipH, 4).lineWidth(0.5).stroke(BORDER);
        doc
          .font("bn")
          .fontSize(6.5)
          .fillColor(MUTED)
          .text(k.label.toUpperCase(), x + 7, y + 6, {
            width: chipW - 14,
            height: 8,
            ellipsis: true,
            lineBreak: false,
          });
        doc
          .font("bn-b")
          .fontSize(10.5)
          .fillColor(INK)
          .text(k.value, x + 7, y + 16, {
            width: chipW - 14,
            height: 13,
            ellipsis: true,
            lineBreak: false,
          });
      });
      y += 34 + 14;
    }

    // ---------- sections ----------
    for (const section of payload.sections) {
      y = drawSection(doc, section, { y, contentW, bottom, newPage });
      y += 16;
    }

    // ---------- footer on every page ----------
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const fy = pageH - MARGIN + 2;
      doc
        .font("bn")
        .fontSize(6.5)
        .fillColor(MUTED)
        .text(
          `Generated ${dhakaNow()} (Asia/Dhaka) by ${meta.generatedBy} — Gift Valy`,
          MARGIN,
          fy,
          { width: contentW / 2, lineBreak: false }
        )
        .text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN + contentW / 2, fy, {
          width: contentW / 2,
          align: "right",
          lineBreak: false,
        });
    }

    doc.end();
  });
}

// Proportional column widths from measured content: each column's natural width
// is the widest of its header and cells (sampled), then everything is scaled to
// exactly fill the content width. Long cells wrap — widths only set proportions.
function columnWidths(
  doc: Doc,
  section: ReportPdfSection,
  contentW: number
): number[] {
  const cols = section.headers.length;
  const sample = section.rows.slice(0, 60);
  const natural = section.headers.map((h, c) => {
    doc.font("bn-b").fontSize(HEAD_FONT);
    let w = doc.widthOfString(h);
    doc.font("bn").fontSize(TABLE_FONT);
    for (const row of sample) {
      const cell = row[c];
      if (cell != null && cell !== "") {
        w = Math.max(w, doc.widthOfString(String(cell)));
      }
    }
    // padding both sides; cap so one verbose column can't starve the rest
    return Math.min(w + CELL_PAD_X * 2 + 2, contentW * 0.45);
  });
  const total = natural.reduce((s, w) => s + w, 0);
  const scale = contentW / total;
  return natural.map((w) => Math.max(w * scale, cols > 8 ? 30 : 40));
}

function drawSection(
  doc: Doc,
  section: ReportPdfSection,
  ctx: { y: number; contentW: number; bottom: number; newPage: () => void }
): number {
  let y = ctx.y;
  const { contentW, bottom } = ctx;
  const startX = MARGIN;

  const headingH = section.heading ? 16 : 0;
  const noteH = section.note
    ? doc.font("bn").fontSize(7).heightOfString(section.note, { width: contentW }) + 3
    : 0;

  // Keep heading + note + header row + first data row together.
  if (y + headingH + noteH + 40 > bottom) {
    ctx.newPage();
    y = MARGIN;
  }

  if (section.heading) {
    doc.font("bn-b").fontSize(10).fillColor(INK).text(section.heading, startX, y);
    y += headingH;
  }
  if (section.note) {
    doc.font("bn").fontSize(7).fillColor(MUTED).text(section.note, startX, y, {
      width: contentW,
    });
    y += noteH;
  }
  y += 2;

  const widths = columnWidths(doc, section, contentW);
  const xs: number[] = [];
  let acc = startX;
  for (const w of widths) {
    xs.push(acc);
    acc += w;
  }
  const align = (c: number) => (section.aligns?.[c] === "r" ? "right" : "left");

  const drawHeaderRow = () => {
    doc.font("bn-b").fontSize(HEAD_FONT);
    const h =
      Math.max(
        ...section.headers.map((hd, c) =>
          doc.heightOfString(hd, { width: widths[c] - CELL_PAD_X * 2 })
        )
      ) +
      CELL_PAD_Y * 2;
    doc.rect(startX, y, contentW, h).fill(HEADER_FILL);
    doc.fillColor("#ffffff");
    section.headers.forEach((hd, c) => {
      doc.text(hd, xs[c] + CELL_PAD_X, y + CELL_PAD_Y, {
        width: widths[c] - CELL_PAD_X * 2,
        align: align(c),
      });
    });
    y += h;
  };
  drawHeaderRow();

  doc.font("bn").fontSize(TABLE_FONT);
  if (section.rows.length === 0) {
    doc
      .fillColor(MUTED)
      .text("No data for this range.", startX + CELL_PAD_X, y + CELL_PAD_Y, {
        width: contentW - CELL_PAD_X * 2,
      });
    y += 18;
    return y;
  }

  section.rows.forEach((row, r) => {
    const cells = row.map((v) => (v == null ? "" : String(v)));
    const h =
      Math.max(
        12,
        ...cells.map((cell, c) =>
          doc.heightOfString(cell || " ", { width: widths[c] - CELL_PAD_X * 2 })
        )
      ) +
      CELL_PAD_Y * 2;
    if (y + h > bottom) {
      ctx.newPage();
      y = MARGIN;
      drawHeaderRow();
      doc.font("bn").fontSize(TABLE_FONT);
    }
    if (r % 2 === 1) doc.rect(startX, y, contentW, h).fill(ZEBRA);
    doc.fillColor(INK);
    cells.forEach((cell, c) => {
      doc.text(cell, xs[c] + CELL_PAD_X, y + CELL_PAD_Y, {
        width: widths[c] - CELL_PAD_X * 2,
        align: align(c),
      });
    });
    y += h;
    doc
      .moveTo(startX, y)
      .lineTo(startX + contentW, y)
      .lineWidth(0.4)
      .stroke(BORDER);
  });

  return y;
}
