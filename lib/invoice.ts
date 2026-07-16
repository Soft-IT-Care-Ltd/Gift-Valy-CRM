import path from "path";
import { mkdir, writeFile } from "fs/promises";
import PDFDocument from "pdfkit";
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
//
// CORRECTIONS Orders §6i — the invoice is HALF an A4 page (an A5-landscape
// slot): a single invoice prints on the top half of an A4 sheet with a dashed
// cut line at the middle; bulk print (§6h) fills each A4 page with two
// invoices, one per half, cut line between them.

// Owner-editable letterhead. The logo box stays a placeholder until a real
// logo file exists — drop one in and swap drawLogoPlaceholder for doc.image.
const COMPANY = {
  name: "Gift Valy",
  taglineBn: "প্রবাসীর ভালোবাসা, প্রিয়জনের দুয়ারে",
  contactLine: "WhatsApp: +880 1XXX-XXXXXX  ·  facebook.com/giftvaly  ·  Dhaka, Bangladesh",
};

// Condensed to one line each — the half-A4 slot has no room for a terms list.
const FOOTER_TERMS_LINE =
  "ডেলিভারির সময় বাকি টাকা (COD) পরিশোধযোগ্য  ·  অর্ডার নিশ্চিত হওয়ার পর অগ্রিম ফেরতযোগ্য নয়  ·  পণ্য গ্রহণের সময় প্যাকেজ খুলে মিলিয়ে নিন  ·  কম্পিউটারে তৈরি ইনভয়েস, স্বাক্ষরের প্রয়োজন নেই";

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

// A4 geometry — every invoice renders inside one half (§6i).
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const HALF_H = PAGE_H / 2;
const SLOT_MARGIN = 26; // inner margin of a half-page slot

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
      product: { select: { name: true, sku: true } },
      package: { select: { name: true, code: true } },
    },
  },
  payments: true,
} satisfies Prisma.OrderInclude;

export type InvoiceOrder = Prisma.OrderGetPayload<{
  include: typeof invoiceOrderInclude;
}>;

type Doc = PDFKit.PDFDocument;

// Emoji (e.g. the ❤ in "Special One ❤") are outside Noto Sans Bengali's
// glyph set — strip them so the PDF never renders tofu boxes.
const pdfSafe = (s: string) =>
  s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2764}️]/gu, "").trim();

function drawLogoPlaceholder(doc: Doc, x: number, y: number, size: number) {
  doc.roundedRect(x, y, size, size, 5).lineWidth(1).stroke(BRAND);
  doc
    .font("bn-b")
    .fontSize(size * 0.42)
    .fillColor(BRAND)
    .text("GV", x, y + size / 2 - size * 0.3, { width: size, align: "center" });
}

// Dashed cut line at the page middle — scissors glyphs are outside the Bangla
// font, so a labelled dash line marks the cut instead (§6i).
function drawCutLine(doc: Doc) {
  doc
    .moveTo(14, HALF_H)
    .lineTo(PAGE_W - 14, HALF_H)
    .lineWidth(0.6)
    .dash(4, { space: 4 })
    .stroke("#9ca3af");
  doc.undash();
  doc
    .font("bn")
    .fontSize(5.5)
    .fillColor("#9ca3af")
    .text("— — cut here — —", PAGE_W / 2 - 40, HALF_H - 7, {
      width: 80,
      align: "center",
    });
}

// ---------- one invoice into one half-page slot (§6i) ----------

function drawInvoiceHalf(
  doc: Doc,
  order: InvoiceOrder,
  version: number,
  currency: CurrencyDisplay | null | undefined,
  top: number // 0 for the upper half, HALF_H for the lower
) {
  const x0 = SLOT_MARGIN;
  const x1 = PAGE_W - SLOT_MARGIN;
  const W = x1 - x0;
  const slotBottom = top + HALF_H - 16;
  let y = top + 18;

  // ---- Header: logo + company vs INVOICE meta ----
  drawLogoPlaceholder(doc, x0, y, 30);
  const companyX = x0 + 38;
  doc.font("bn-b").fontSize(13).fillColor(BRAND).text(COMPANY.name, companyX, y - 1);
  doc
    .font("bn")
    .fontSize(6.5)
    .fillColor(MUTED)
    .text(COMPANY.taglineBn, companyX, y + 16)
    .text(COMPANY.contactLine, companyX, y + 25);

  const metaW = 180;
  const metaX = x1 - metaW;
  doc.font("bn-b").fontSize(11).fillColor(INK).text("INVOICE", metaX, y - 1, {
    width: metaW,
    align: "right",
  });
  doc
    .font("bn-b")
    .fontSize(8.5)
    .text(order.orderNo, metaX, y + 13, { width: metaW, align: "right" });
  doc
    .font("bn")
    .fontSize(6.5)
    .fillColor(MUTED)
    .text(
      `Date: ${dhakaDate(order.createdAt)}${version > 1 ? `  ·  v${version}` : ""}`,
      metaX,
      y + 24,
      { width: metaW, align: "right" }
    );

  y += 38;
  doc.moveTo(x0, y).lineTo(x1, y).lineWidth(0.75).stroke(BORDER);
  y += 6;

  // ---- Parties: customer (payer abroad) & recipient (BD) ----
  const colW = W / 2 - 10;
  const rightX = x0 + colW + 20;

  doc
    .font("bn-b")
    .fontSize(6)
    .fillColor(MUTED)
    .text("BILL TO — CUSTOMER (কাস্টমার)", x0, y)
    .text("DELIVER TO — RECIPIENT (প্রাপক)", rightX, y);
  y += 9;

  const recipientName =
    order.recipientName +
    (order.recipientRelation ? `  (${pdfSafe(order.recipientRelation)})` : "");
  doc.font("bn-b").fontSize(8.5).fillColor(INK);
  doc.text(order.customer.name, x0, y, { width: colW, height: 12, ellipsis: true });
  doc.text(recipientName, rightX, y, { width: colW, height: 12, ellipsis: true });
  y += 12;

  doc.font("bn").fontSize(8).fillColor(INK);
  doc.text(order.customer.phoneForeign, x0, y, { width: colW });
  doc.text(order.recipientPhoneBd, rightX, y, { width: colW });
  y += 11;

  // District/Thana are "" on new orders (CORRECTIONS Orders §5).
  const addr = [order.deliveryAddress, order.thana, order.district]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");
  doc.font("bn").fontSize(7).fillColor(MUTED);
  doc.text(order.customer.country, x0, y, { width: colW, height: 9 });
  // address gets up to two lines, then truncates — the courier slip carries
  // the full text; the invoice identifies the delivery.
  const addrH = Math.min(doc.heightOfString(addr, { width: colW }), 18);
  doc.text(addr, rightX, y, { width: colW, height: 18, ellipsis: true });
  y += Math.max(addrH, 9) + 2;

  // Delivery timing (CORRECTIONS Orders §1): fixed dates are the important
  // ones — the parcel must arrive ON the day.
  const deliveryLine =
    order.deliveryDateMode === "FIXED" && order.requestedDeliveryDate
      ? `Deliver ON: ${dhakaDate(order.requestedDeliveryDate)} (fixed date)`
      : order.deliveryDateMode === "ASAP"
        ? "Delivery: ASAP / Urgent"
        : null;
  const extras = [
    order.occasion ? `Occasion: ${pdfSafe(order.occasion)}` : null,
    deliveryLine,
  ]
    .filter(Boolean)
    .join("  ·  ");
  if (extras) {
    doc.font("bn-b").fontSize(6.5).fillColor(AMBER);
    doc.text(extras, rightX, y, { width: colW, height: 9, ellipsis: true });
  }
  y += extras ? 11 : 3;

  // ---- Item table: name, qty, unit price, amount (§5) ----
  const col = {
    no: { x: x0, w: 18 },
    item: { x: x0 + 18, w: W - 18 - 36 - 76 - 80 },
    qty: { x: x1 - 36 - 76 - 80, w: 36 },
    unit: { x: x1 - 76 - 80, w: 76 },
    total: { x: x1 - 80, w: 80 },
  };
  const pad = 4;
  const ROW_H = 13;

  doc.rect(x0, y, W, 13).fill(HEADER_FILL);
  doc.font("bn-b").fontSize(7).fillColor("#ffffff");
  const hy = y + 2.5;
  doc.text("#", col.no.x + pad, hy, { width: col.no.w - pad });
  doc.text("Item (পণ্য)", col.item.x, hy, { width: col.item.w });
  doc.text("Qty", col.qty.x, hy, { width: col.qty.w - pad, align: "right" });
  doc.text("Unit Price", col.unit.x, hy, { width: col.unit.w - pad, align: "right" });
  doc.text("Amount", col.total.x, hy, { width: col.total.w - pad, align: "right" });
  y += 13;

  // The totals/footer block needs this much of the slot — items get the rest.
  const reservedBottom = (currency ? 116 : 100) + 18;
  const maxRows = Math.max(
    1,
    Math.floor((slotBottom - reservedBottom - y) / ROW_H)
  );
  // All items fit? Every row prints. Otherwise the last visible row condenses
  // the remainder into "+N more items" — totals always cover everything.
  const visible =
    order.items.length <= maxRows
      ? order.items
      : order.items.slice(0, maxRows - 1);
  const rest = order.items.slice(visible.length);

  const drawRow = (
    i: number,
    label: string,
    qty: string,
    unit: string,
    amount: string,
    muted = false
  ) => {
    if (i % 2 === 1) doc.rect(x0, y, W, ROW_H).fill(ZEBRA);
    const ty = y + 2.5;
    doc.font("bn").fontSize(7.5);
    doc.fillColor(MUTED).text(String(i + 1), col.no.x + pad, ty, {
      width: col.no.w - pad,
    });
    doc.fillColor(muted ? MUTED : INK).text(label, col.item.x, ty, {
      width: col.item.w - pad,
      height: 10,
      ellipsis: true,
    });
    doc.text(qty, col.qty.x, ty, { width: col.qty.w - pad, align: "right" });
    doc.text(unit, col.unit.x, ty, { width: col.unit.w - pad, align: "right" });
    doc.text(amount, col.total.x, ty, { width: col.total.w - pad, align: "right" });
    y += ROW_H;
    doc.moveTo(x0, y).lineTo(x1, y).lineWidth(0.4).stroke(BORDER);
  };

  visible.forEach((it, i) => {
    const name = it.product?.name ?? it.package?.name ?? it.customName ?? "(custom)";
    const code = it.product?.sku ?? it.package?.code;
    const label =
      pdfSafe(name) +
      (it.itemType === "PACKAGE" ? "  [Package]" : "") +
      (code ? `  ·  ${code}` : "");
    drawRow(i, label, String(it.qty), bdt(Number(it.unitPrice)), bdt(Number(it.lineTotal)));
  });
  if (rest.length > 0) {
    const qtySum = rest.reduce((s, it) => s + it.qty, 0);
    const amountSum = rest.reduce((s, it) => s + Number(it.lineTotal), 0);
    drawRow(
      visible.length,
      `… +${rest.length} more item${rest.length === 1 ? "" : "s"} (full list on the order)`,
      String(qtySum),
      "",
      bdt(amountSum),
      true
    );
  }
  y += 5;

  // ---- Totals (right) + payment info & invoice note (left) ----
  const totalsW = 218;
  const totalsX = x1 - totalsW;
  const leftW = W - totalsW - 16;
  const blockTop = y;

  const row = (
    label: string,
    value: string,
    opts: { bold?: boolean; color?: string; size?: number } = {}
  ) => {
    const size = opts.size ?? 7.5;
    doc.font(opts.bold ? "bn-b" : "bn").fontSize(size).fillColor(opts.color ?? INK);
    doc.text(label, totalsX, y, { width: totalsW - 92 });
    doc.text(value, totalsX + totalsW - 92, y, { width: 92, align: "right" });
    y += doc.currentLineHeight() + 1.5;
  };
  // "~ SAR 107.69" under a BDT amount — customer-currency display (§5).
  // "~" not "≈": U+2248 is outside Noto Sans Bengali's glyph set.
  const approxRow = (n: number) => {
    if (!currency) return;
    doc.font("bn").fontSize(6.5).fillColor(MUTED);
    doc.text(`~ ${formatInCurrency(n, currency)}`, totalsX, y - 1, {
      width: totalsW,
      align: "right",
    });
    y += doc.currentLineHeight() + 1;
  };

  // Rejected payments (money never received, SPEC §8) never appear as paid.
  const advance = order.payments
    .filter((p) => p.type === "ADVANCE" && !p.isRejected)
    .sort((a, b) => a.paymentDate.getTime() - b.paymentDate.getTime())[0];
  const paid = order.payments.reduce(
    (s, p) =>
      p.isRejected ? s : s + (p.type === "REFUND" ? -Number(p.amount) : Number(p.amount)),
    0
  );

  row("Subtotal (সাবটোটাল)", bdt(Number(order.subtotal)), { color: MUTED });
  row("Discount (ডিসকাউন্ট)", `−${bdt(Number(order.discount))}`, { color: MUTED });
  row("Courier (কুরিয়ার চার্জ)", bdt(Number(order.courierChargeCustomer)), {
    color: MUTED,
  });
  doc.moveTo(totalsX, y).lineTo(x1, y).lineWidth(0.75).stroke(INK);
  y += 3;
  row("Grand Total (সর্বমোট)", bdt(Number(order.totalAmount)), { bold: true, size: 9 });
  approxRow(Number(order.totalAmount));
  row("Paid (জমা)", `−${bdt(paid)}`, { color: GREEN });
  doc.moveTo(totalsX, y).lineTo(x1, y).lineWidth(0.75).stroke(INK);
  y += 3;
  row("Due / COD (বাকি)", bdt(Number(order.dueAmount)), {
    bold: true,
    size: 9,
    color: Number(order.dueAmount) > 0 ? AMBER : GREEN,
  });
  approxRow(Number(order.dueAmount));
  if (currency) {
    doc.font("bn").fontSize(5.5).fillColor(MUTED);
    doc.text(
      `${currency.code} approx. (${rateLine(currency)}) — payable amount is the ৳ figure.`,
      totalsX,
      y,
      { width: totalsW, align: "right" }
    );
  }

  // Left column: how the advance was paid + the customer-visible note (§6d).
  let ly = blockTop;
  if (advance) {
    doc.font("bn-b").fontSize(6).fillColor(MUTED).text("PAYMENT", x0, ly);
    ly += 8;
    doc
      .font("bn")
      .fontSize(6.5)
      .fillColor(INK)
      .text(
        `Advance ${bdt(Number(advance.amount))} — ${
          PAYMENT_METHOD_LABELS[advance.method] ?? advance.method
        }${advance.transactionId ? `  ·  Txn: ${advance.transactionId}` : ""}`,
        x0,
        ly,
        { width: leftW, height: 16, ellipsis: true }
      );
    ly += 16;
  }
  if (order.invoiceNote?.trim()) {
    doc.font("bn-b").fontSize(6).fillColor(MUTED).text("NOTE (নোট)", x0, ly);
    ly += 8;
    doc
      .font("bn")
      .fontSize(7)
      .fillColor(INK)
      .text(order.invoiceNote.trim(), x0, ly, {
        width: leftW,
        height: 28,
        ellipsis: true,
      });
  }

  // ---- Footer: one-line terms + brand line, pinned to the slot bottom ----
  doc
    .moveTo(x0, slotBottom - 16)
    .lineTo(x1, slotBottom - 16)
    .lineWidth(0.4)
    .stroke(BORDER);
  doc
    .font("bn")
    .fontSize(5.5)
    .fillColor(MUTED)
    .text(FOOTER_TERMS_LINE, x0, slotBottom - 13, {
      width: W,
      height: 7,
      ellipsis: true,
      align: "center",
    });
  doc
    .font("bn-b")
    .fontSize(6.5)
    .fillColor(BRAND)
    .text(
      `${COMPANY.name} — আপনার ভালোবাসা পৌঁছে দিতে পেরে আমরা আনন্দিত`,
      x0,
      slotBottom - 5,
      { width: W, align: "center" }
    );
}

// ---------- document assembly ----------

function createDoc(title: string): Doc {
  // font in the constructor: skips pdfkit's default Helvetica (AFM) load,
  // so Noto Sans Bengali is the only font ever touched.
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    font: FONT_REGULAR,
    info: { Title: title, Author: COMPANY.name },
  });
  doc.registerFont("bn", FONT_REGULAR);
  doc.registerFont("bn-b", FONT_BOLD);
  return doc;
}

function docToBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

// Single invoice (§6i): top half of an A4 page + cut line; the lower half
// stays blank for the scissors.
// currency (SPEC §5, optional): when the customer's country matches a row in
// the Admin rate table, totals also show approximate customer-currency values.
export async function renderInvoicePdf(
  order: InvoiceOrder,
  version: number,
  currency?: CurrencyDisplay | null
): Promise<Buffer> {
  const doc = createDoc(`Invoice ${order.orderNo} v${version}`);
  drawInvoiceHalf(doc, order, version, currency, 0);
  drawCutLine(doc);
  return docToBuffer(doc);
}

export interface BatchInvoiceEntry {
  order: InvoiceOrder;
  version: number;
  currency?: CurrencyDisplay | null;
}

// Bulk print (§6h): one PDF, two invoices per A4 page (§6i), cut line between
// them — 20 selected orders come out as 10 sheets.
export async function renderInvoiceBatchPdf(
  entries: BatchInvoiceEntry[]
): Promise<Buffer> {
  if (entries.length === 0) throw new Error("No invoices to render");
  const doc = createDoc(`Invoices — ${entries.length} orders`);
  entries.forEach((entry, i) => {
    const slot = i % 2;
    if (i > 0 && slot === 0) doc.addPage();
    if (slot === 0) drawCutLine(doc);
    drawInvoiceHalf(doc, entry.order, entry.version, entry.currency, slot * HALF_H);
  });
  return docToBuffer(doc);
}

// ---------- generation + versioning ----------

export async function loadInvoiceOrder(orderId: number): Promise<InvoiceOrder> {
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: invoiceOrderInclude,
  });
}

// Bulk print (§6h) — ordered by order number so the printed stack is sorted.
// The lib/db.ts trash auto-filter silently drops trashed ids.
export async function loadInvoiceOrders(orderIds: number[]): Promise<InvoiceOrder[]> {
  return prisma.order.findMany({
    where: { id: { in: orderIds } },
    include: invoiceOrderInclude,
    orderBy: { orderNo: "asc" },
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
