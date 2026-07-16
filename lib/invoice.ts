import path from "path";
import { mkdir, writeFile } from "fs/promises";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { Prisma, type Invoice } from "@prisma/client";
import { prisma } from "./db";
import { logAudit } from "./audit";
import { PAYMENT_METHOD_LABELS } from "./order-constants";
import { getCurrencyForCountry } from "./currency";
import {
  formatInCurrency,
  rateLine,
  type CurrencyDisplay,
} from "./currency-constants";

// ============ SPEC §5 — Invoice PDF generation & versioning ============
// Auto-generated on order confirmation; regenerated (version N+1) when an
// approved edit changes the order. Old versions and their files are kept.
// PDFs live in storage/invoices (NOT public/) — they carry customer PII and
// are only served through the authenticated download route.

// Owner-editable letterhead. The logo box stays a placeholder until a real
// logo file exists — drop one in and swap drawLogoPlaceholder for doc.image.
const COMPANY = {
  name: "Gift Valy",
  taglineBn: "প্রবাসীর ভালোবাসা, প্রিয়জনের দুয়ারে",
  contactLine: "WhatsApp: +880 1XXX-XXXXXX  ·  facebook.com/giftvaly  ·  Dhaka, Bangladesh",
};

const FOOTER_TERMS = [
  "ডেলিভারির সময় বাকি টাকা (COD) পরিশোধযোগ্য। অর্ডার নিশ্চিত হওয়ার পর অগ্রিম ফেরতযোগ্য নয়।",
  "পণ্য গ্রহণের সময় প্যাকেজ খুলে মিলিয়ে নিন — পরে অভিযোগ গ্রহণ করা সম্ভব নাও হতে পারে।",
  "This is a computer-generated invoice — no signature required. এটি কম্পিউটারে তৈরি ইনভয়েস, স্বাক্ষরের প্রয়োজন নেই।",
];

const FONT_DIR = path.join(process.cwd(), "public", "fonts");
const FONT_REGULAR = path.join(FONT_DIR, "NotoSansBengali-Regular.ttf");
const FONT_BOLD = path.join(FONT_DIR, "NotoSansBengali-Bold.ttf");

export const INVOICE_DIR = path.join(process.cwd(), "storage", "invoices");

// Colors
const INK = "#111827";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";
const ZEBRA = "#f8fafc";
const BRAND = "#be185d";
const HEADER_FILL = "#1f2937";
const GREEN = "#15803d";
const AMBER = "#b45309";

// A4 geometry
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ৳ with en-IN digit grouping, decimals only when the amount has them —
// matches lib/format.ts money() so screen and paper always agree.
function bdt(n: number): string {
  const opts =
    Math.round(n * 100) % 100 === 0
      ? undefined
      : ({ minimumFractionDigits: 2, maximumFractionDigits: 2 } as const);
  return `৳${n.toLocaleString("en-IN", opts)}`;
}

function dhakaDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const invoiceOrderInclude = {
  customer: true,
  items: {
    include: {
      product: { select: { name: true, sku: true, photoUrl: true } },
      package: { select: { name: true, code: true, photoUrl: true } },
    },
  },
  payments: true,
} satisfies Prisma.OrderInclude;

export type InvoiceOrder = Prisma.OrderGetPayload<{
  include: typeof invoiceOrderInclude;
}>;

type Doc = PDFKit.PDFDocument;

function drawLogoPlaceholder(doc: Doc, x: number, y: number, size: number) {
  doc.roundedRect(x, y, size, size, 6).lineWidth(1).stroke(BRAND);
  doc
    .font("bn-b")
    .fontSize(16)
    .fillColor(BRAND)
    .text("GV", x, y + size / 2 - 12, { width: size, align: "center" });
  doc
    .font("bn")
    .fontSize(5.5)
    .fillColor(MUTED)
    .text("LOGO", x, y + size - 12, { width: size, align: "center" });
}

// Bottom edge where flowing content must stop before we add a page.
const BOTTOM = PAGE_H - MARGIN - 30;

// Rendered size of the item-photo thumbnail in the table (pt).
const THUMB = 26;

// photoUrl → small square JPEG via sharp. Normalizing is required, not just
// nice: uploads may be WebP (pdfkit can't embed it) or multi-MB (would bloat
// every invoice PDF). Unreadable/missing photos fall back to the placeholder.
async function loadThumbnails(order: InvoiceOrder): Promise<Map<string, Buffer>> {
  const urls = [
    ...new Set(
      order.items
        .map((it) => it.product?.photoUrl ?? it.package?.photoUrl)
        .filter((u): u is string => !!u)
    ),
  ];
  const thumbs = new Map<string, Buffer>();
  await Promise.all(
    urls.map(async (url) => {
      try {
        const file = path.join(process.cwd(), "public", url.replace(/^\//, ""));
        const buf = await sharp(file)
          .resize(96, 96, { fit: "cover" })
          .jpeg({ quality: 75 })
          .toBuffer();
        thumbs.set(url, buf);
      } catch {
        // fall through to the no-photo placeholder
      }
    })
  );
  return thumbs;
}

function drawItemThumb(doc: Doc, thumb: Buffer | undefined, x: number, y: number) {
  if (thumb) {
    doc.save();
    doc.roundedRect(x, y, THUMB, THUMB, 3).clip();
    doc.image(thumb, x, y, { width: THUMB, height: THUMB });
    doc.restore();
  } else {
    doc
      .font("bn")
      .fontSize(4.5)
      .fillColor(MUTED)
      .text("NO PHOTO", x, y + THUMB / 2 - 3, { width: THUMB, align: "center" });
  }
  doc.roundedRect(x, y, THUMB, THUMB, 3).lineWidth(0.5).stroke(BORDER);
}

// currency (SPEC §5, optional): when the customer's country matches a row in
// the Admin rate table, totals also show approximate customer-currency values.
export async function renderInvoicePdf(
  order: InvoiceOrder,
  version: number,
  currency?: CurrencyDisplay | null
): Promise<Buffer> {
  const thumbs = await loadThumbnails(order);
  return new Promise((resolve, reject) => {
    // font in the constructor: skips pdfkit's default Helvetica (AFM) load,
    // so Noto Sans Bengali is the only font ever touched.
    const doc = new PDFDocument({
      size: "A4",
      margin: MARGIN,
      font: FONT_REGULAR,
      info: {
        Title: `Invoice ${order.orderNo} v${version}`,
        Author: COMPANY.name,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("bn", FONT_REGULAR);
    doc.registerFont("bn-b", FONT_BOLD);

    // ---------- Header: logo placeholder + company vs INVOICE meta ----------
    drawLogoPlaceholder(doc, MARGIN, MARGIN, 54);
    const companyX = MARGIN + 66;
    doc.font("bn-b").fontSize(20).fillColor(BRAND).text(COMPANY.name, companyX, MARGIN);
    doc
      .font("bn")
      .fontSize(9)
      .fillColor(MUTED)
      .text(COMPANY.taglineBn, companyX, MARGIN + 27)
      .fontSize(7.5)
      .text(COMPANY.contactLine, companyX, MARGIN + 41);

    const metaW = 200;
    const metaX = PAGE_W - MARGIN - metaW;
    doc.font("bn-b").fontSize(17).fillColor(INK).text("INVOICE", metaX, MARGIN, {
      width: metaW,
      align: "right",
    });
    doc
      .font("bn-b")
      .fontSize(10)
      .text(order.orderNo, metaX, MARGIN + 24, { width: metaW, align: "right" });
    doc
      .font("bn")
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(`Date: ${dhakaDate(order.createdAt)}`, metaX, MARGIN + 38, {
        width: metaW,
        align: "right",
      });
    if (version > 1) {
      doc.text(
        `Version ${version} — supersedes v${version - 1}`,
        metaX,
        MARGIN + 50,
        { width: metaW, align: "right" }
      );
    }

    doc
      .moveTo(MARGIN, MARGIN + 68)
      .lineTo(PAGE_W - MARGIN, MARGIN + 68)
      .lineWidth(1)
      .stroke(BORDER);

    // ---------- Parties: customer (payer abroad) & recipient (BD) ----------
    let y = MARGIN + 82;
    const colW = CONTENT_W / 2 - 12;
    const rightX = MARGIN + colW + 24;

    doc
      .font("bn-b")
      .fontSize(7.5)
      .fillColor(MUTED)
      .text("BILL TO — CUSTOMER (কাস্টমার)", MARGIN, y)
      .text("DELIVER TO — RECIPIENT (প্রাপক)", rightX, y);
    y += 13;

    doc.font("bn-b").fontSize(11).fillColor(INK);
    doc.text(order.customer.name, MARGIN, y, { width: colW });
    const recipientName =
      order.recipientName +
      (order.recipientRelation ? `  (${order.recipientRelation})` : "");
    doc.text(recipientName, rightX, y, { width: colW });
    const nameH = Math.max(
      doc.heightOfString(order.customer.name, { width: colW }),
      doc.heightOfString(recipientName, { width: colW })
    );
    y += nameH + 2;

    doc.font("bn").fontSize(9.5).fillColor(INK);
    doc.text(order.customer.phoneForeign, MARGIN, y, { width: colW });
    doc.text(order.recipientPhoneBd, rightX, y, { width: colW });
    y += 14;

    doc.fillColor(MUTED);
    const leftRest = order.customer.country;
    const addr = `${order.deliveryAddress}, ${order.thana}, ${order.district}`;
    const extras = [
      order.occasion ? `Occasion: ${order.occasion}` : null,
      order.requestedDeliveryDate
        ? `Deliver by: ${dhakaDate(order.requestedDeliveryDate)}`
        : null,
    ]
      .filter(Boolean)
      .join("  ·  ");
    const rightRest = extras ? `${addr}\n${extras}` : addr;
    doc.text(leftRest, MARGIN, y, { width: colW });
    doc.text(rightRest, rightX, y, { width: colW });
    y +=
      Math.max(
        doc.heightOfString(leftRest, { width: colW }),
        doc.heightOfString(rightRest, { width: colW })
      ) + 16;

    // ---------- Item table (§5: name, qty, unit price, subtotal) ----------
    const col = {
      no: { x: MARGIN, w: 26 },
      item: { x: MARGIN + 26, w: CONTENT_W - 26 - 54 - 100 - 100 },
      qty: { x: MARGIN + CONTENT_W - 254, w: 54 },
      unit: { x: MARGIN + CONTENT_W - 200, w: 100 },
      total: { x: MARGIN + CONTENT_W - 100, w: 100 },
    };
    const cellPad = 6;

    const drawTableHeader = () => {
      doc.rect(MARGIN, y, CONTENT_W, 20).fill(HEADER_FILL);
      doc.font("bn-b").fontSize(8.5).fillColor("#ffffff");
      const ty = y + 4;
      doc.text("#", col.no.x + cellPad, ty, { width: col.no.w - cellPad });
      doc.text("Item (পণ্য)", col.item.x, ty, { width: col.item.w });
      doc.text("Qty", col.qty.x, ty, { width: col.qty.w - cellPad, align: "right" });
      doc.text("Unit Price", col.unit.x, ty, { width: col.unit.w - cellPad, align: "right" });
      doc.text("Amount", col.total.x, ty, { width: col.total.w - cellPad, align: "right" });
      y += 20;
    };
    drawTableHeader();

    order.items.forEach((it, i) => {
      const name = it.product?.name ?? it.package?.name ?? it.customName ?? "(custom)";
      const code = it.product?.sku ?? it.package?.code;
      const label =
        name +
        (it.itemType === "PACKAGE" ? "  [Package]" : "") +
        (code ? `  ·  ${code}` : "");
      // text sits to the right of the photo thumbnail
      const textX = col.item.x + THUMB + 8;
      const textW = col.item.w - THUMB - 8 - cellPad;
      doc.font("bn").fontSize(9.5);
      const rowH = Math.max(
        Math.max(doc.heightOfString(label, { width: textW }), 12) + 9,
        THUMB + 8
      );

      if (y + rowH > BOTTOM) {
        doc.addPage();
        y = MARGIN;
        drawTableHeader();
      }
      if (i % 2 === 1) doc.rect(MARGIN, y, CONTENT_W, rowH).fill(ZEBRA);

      const photoUrl = it.product?.photoUrl ?? it.package?.photoUrl;
      drawItemThumb(doc, photoUrl ? thumbs.get(photoUrl) : undefined, col.item.x, y + 4);

      const ty = y + 4;
      doc.font("bn").fontSize(9.5);
      doc.fillColor(MUTED).text(String(i + 1), col.no.x + cellPad, ty, {
        width: col.no.w - cellPad,
      });
      doc.fillColor(INK).text(label, textX, ty, { width: textW });
      doc.text(String(it.qty), col.qty.x, ty, { width: col.qty.w - cellPad, align: "right" });
      doc.text(bdt(Number(it.unitPrice)), col.unit.x, ty, {
        width: col.unit.w - cellPad,
        align: "right",
      });
      doc.text(bdt(Number(it.lineTotal)), col.total.x, ty, {
        width: col.total.w - cellPad,
        align: "right",
      });
      y += rowH;
      doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).stroke(BORDER);
    });

    // ---------- Totals (§5: discount, courier, grand total, advance, due) ----------
    const totalsW = 250;
    const totalsX = PAGE_W - MARGIN - totalsW;
    // ~170pt tall block (+~30pt of currency lines) + footer must not straddle
    // a page break.
    if (y + (currency ? 220 : 190) > BOTTOM) {
      doc.addPage();
      y = MARGIN;
    }
    y += 10;

    // Rejected payments (money never received, SPEC §8) never appear as paid.
    const advance = order.payments
      .filter((p) => p.type === "ADVANCE" && !p.isRejected)
      .sort((a, b) => a.paymentDate.getTime() - b.paymentDate.getTime())[0];
    const paid = order.payments.reduce(
      (s, p) =>
        p.isRejected
          ? s
          : s + (p.type === "REFUND" ? -Number(p.amount) : Number(p.amount)),
      0
    );

    const row = (
      label: string,
      value: string,
      opts: { bold?: boolean; color?: string; size?: number; sub?: string } = {}
    ) => {
      const size = opts.size ?? 9.5;
      doc.font(opts.bold ? "bn-b" : "bn").fontSize(size).fillColor(opts.color ?? INK);
      doc.text(label, totalsX, y, { width: totalsW - 110 });
      doc.text(value, totalsX + totalsW - 110, y, { width: 110, align: "right" });
      y += doc.currentLineHeight() + 3;
      if (opts.sub) {
        doc.font("bn").fontSize(7.5).fillColor(MUTED);
        doc.text(opts.sub, totalsX, y - 2, { width: totalsW });
        y += doc.currentLineHeight() + 3;
      }
    };

    // "~ SAR 107.69" under a BDT amount — the customer-currency display (§5).
    // "~" not "≈": U+2248 is outside Noto Sans Bengali's glyph set.
    const approxRow = (bdt: number) => {
      if (!currency) return;
      doc.font("bn").fontSize(8).fillColor(MUTED);
      doc.text(`~ ${formatInCurrency(bdt, currency)}`, totalsX, y - 2, {
        width: totalsW,
        align: "right",
      });
      y += doc.currentLineHeight() + 2;
    };

    doc.fillColor(MUTED);
    row("Subtotal (সাবটোটাল)", bdt(Number(order.subtotal)), { color: MUTED });
    row("Discount (ডিসকাউন্ট)", `−${bdt(Number(order.discount))}`, { color: MUTED });
    row("Courier Charge (কুরিয়ার চার্জ)", bdt(Number(order.courierChargeCustomer)), {
      color: MUTED,
    });
    doc.moveTo(totalsX, y).lineTo(PAGE_W - MARGIN, y).lineWidth(1).stroke(INK);
    y += 6;
    row("Grand Total (সর্বমোট)", bdt(Number(order.totalAmount)), {
      bold: true,
      size: 11.5,
    });
    approxRow(Number(order.totalAmount));
    row("Advance Paid (অগ্রিম)", `−${bdt(Number(order.advanceAmount))}`, {
      color: GREEN,
      sub: advance
        ? `${PAYMENT_METHOD_LABELS[advance.method] ?? advance.method}${
            advance.transactionId ? `  ·  Txn ID: ${advance.transactionId}` : ""
          }`
        : undefined,
    });
    if (Math.abs(paid - Number(order.advanceAmount)) > 0.005) {
      row("Total Paid (মোট জমা)", `−${bdt(paid)}`, { color: GREEN });
    }
    doc.moveTo(totalsX, y).lineTo(PAGE_W - MARGIN, y).lineWidth(1).stroke(INK);
    y += 6;
    row("Due / COD (বাকি)", bdt(Number(order.dueAmount)), {
      bold: true,
      size: 11.5,
      color: Number(order.dueAmount) > 0 ? AMBER : GREEN,
    });
    approxRow(Number(order.dueAmount));
    if (currency) {
      doc.font("bn").fontSize(7).fillColor(MUTED);
      doc.text(
        `${currency.code} amounts are approximate (${rateLine(currency)}) — payable amount is the ৳ figure.`,
        totalsX,
        y,
        { width: totalsW, align: "right" }
      );
      y += doc.currentLineHeight() + 2;
    }

    // ---------- Footer terms ----------
    y += 18;
    doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).stroke(BORDER);
    y += 8;
    doc.font("bn-b").fontSize(7.5).fillColor(MUTED).text("Terms (শর্তাবলী)", MARGIN, y);
    y += 12;
    doc.font("bn").fontSize(7.5).fillColor(MUTED);
    for (const term of FOOTER_TERMS) {
      doc.text(`•  ${term}`, MARGIN, y, { width: CONTENT_W });
      y += doc.heightOfString(`•  ${term}`, { width: CONTENT_W }) + 3;
    }
    y += 8;
    doc
      .font("bn-b")
      .fontSize(9)
      .fillColor(BRAND)
      .text(`${COMPANY.name} — আপনার ভালোবাসা পৌঁছে দিতে পেরে আমরা আনন্দিত`, MARGIN, y, {
        width: CONTENT_W,
        align: "center",
      });

    doc.end();
  });
}

// ---------- generation + versioning ----------

export async function loadInvoiceOrder(orderId: number): Promise<InvoiceOrder> {
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: invoiceOrderInclude,
  });
}

export function invoiceFileName(orderNo: string, version: number): string {
  return `${orderNo}-v${version}.pdf`;
}

// Renders the next version from current order data, writes the file, records
// the row. Retries once on a concurrent (orderId, version) collision.
export async function generateInvoice(
  orderId: number,
  userId?: number
): Promise<Invoice> {
  const order = await loadInvoiceOrder(orderId);
  const currency = await getCurrencyForCountry(order.customer.country);
  for (let attempt = 0; ; attempt++) {
    const last = await prisma.invoice.findFirst({
      where: { orderId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;
    const pdf = await renderInvoicePdf(order, version, currency);
    const fileName = invoiceFileName(order.orderNo, version);
    await mkdir(INVOICE_DIR, { recursive: true });
    await writeFile(path.join(INVOICE_DIR, fileName), pdf);
    try {
      const invoice = await prisma.invoice.create({
        data: {
          orderId,
          invoiceNo: order.orderNo,
          version,
          pdfUrl: `storage/invoices/${fileName}`,
          generatedBy: userId ?? null,
        },
      });
      if (userId) {
        await logAudit({
          userId,
          action: "invoice.generate",
          entity: "invoices",
          entityId: invoice.id,
          after: { orderNo: order.orderNo, version },
        });
      }
      return invoice;
    } catch (err) {
      const collision =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!collision || attempt >= 1) throw err;
    }
  }
}

// For hooks inside request handlers: the order/edit must succeed even if PDF
// generation fails — the download route regenerates on demand as a fallback.
// A successful generation then auto-sends the PDF to the customer's WhatsApp
// when that integration is on (SPEC §5 / §16 Phase 4); trigger records whether
// this was a fresh confirmation or an approved-edit regeneration.
export async function generateInvoiceSafe(
  orderId: number,
  userId?: number,
  trigger: "AUTO_CONFIRM" | "AUTO_EDIT" = "AUTO_CONFIRM"
): Promise<Invoice | null> {
  try {
    const invoice = await generateInvoice(orderId, userId);
    // Dynamic import: lib/whatsapp imports from this module, so a static
    // import here would be a cycle.
    const { autoSendInvoiceWhatsAppSafe } = await import("./whatsapp");
    await autoSendInvoiceWhatsAppSafe(orderId, trigger);
    return invoice;
  } catch (err) {
    console.error(`Invoice generation failed for order ${orderId}:`, err);
    return null;
  }
}
