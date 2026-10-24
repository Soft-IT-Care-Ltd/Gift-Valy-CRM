import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import sharp from "sharp";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AuthzError } from "./authz";
import { logAuditTx } from "./audit";
import { getPrintSettings } from "./settings";
import { formatDate } from "./format";
import {
  deletePrintFiles,
  printFilePath,
  printPdfPath,
  savePrintFile,
  savePrintPdf,
} from "./file-storage";
import { PRINT_LAYOUTS, slotPixels, type PhotoSlot, type CardSlot, type PrintSettings } from "./print-layouts";
import { kitProgress, normalizePrintKit } from "./print-kit";
import { normalizeCrop } from "./print-crop";
import { makePrintFile } from "./print-photos";
import { renderCard } from "./print-card";
import { cardLines } from "./print-card-text";
import { designForRender, serializeCardDesign } from "./card-library";
import { planPrintPages, type InfoForPrint } from "./print-pdf-plan";
import { renderInfoText, renderPrintPdf } from "./print-pdf";

// ============ PHOTO_PRINT.md PP-6 — one order's print PDF, cached ============
//
// The cache key is a hash of everything the PDF shows: the layout and sizes,
// every live kit's photos (file, slot, position, crop) and cards (design +
// its last change, text, names), and the info box (order no., recipient,
// phone, delivery). The file is INVOICE_DIR/print/<orderNo>-<hash>.pdf, so any
// change to a photo, crop, card or setting simply gives a new name — a stale
// PDF can never be served. Built when a kit becomes ready (warmPrintPdf, after
// every kit change) or on first open.

/** Bump when the drawing changes, so cached PDFs are rebuilt. */
const PDF_RENDER_VERSION = 1;

const orderPrintSelect = {
  id: true,
  orderNo: true,
  recipientName: true,
  recipientPhoneBd: true,
  deliveryDateMode: true,
  requestedDeliveryDate: true,
  printKits: {
    where: { orphanedAt: null },
    orderBy: { id: "asc" },
    include: {
      photos: { orderBy: [{ slot: "asc" }, { position: "asc" }] },
      cards: { orderBy: { slot: "asc" }, include: { design: true } },
    },
  },
} satisfies Prisma.OrderSelect;

type OrderForPrint = Prisma.OrderGetPayload<{ select: typeof orderPrintSelect }>;
type KitRow = OrderForPrint["printKits"][number];

function deliveryLabel(o: OrderForPrint): string {
  if (o.deliveryDateMode === "ASAP") return "ASAP";
  if (o.deliveryDateMode === "FIXED" && o.requestedDeliveryDate) {
    return formatDate(o.requestedDeliveryDate.toISOString());
  }
  return "Any day";
}

function infoFor(o: OrderForPrint): InfoForPrint {
  return {
    orderNo: o.orderNo,
    recipientName: o.recipientName,
    recipientPhone: o.recipientPhoneBd,
    delivery: deliveryLabel(o),
  };
}

/** Every live kit has all its photos and cards. */
export function kitIsComplete(k: { spec: unknown; photoCount: number; cardCount: number }): boolean {
  const spec = normalizePrintKit(k.spec);
  return !!spec && kitProgress(spec, k.photoCount, k.cardCount).state === "READY";
}

async function loadOrder(orderId: number): Promise<OrderForPrint> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: orderPrintSelect });
  if (!order) throw new AuthzError(404, "Order not found");
  if (order.printKits.length === 0) throw new AuthzError(404, "This order has no photos or cards to print");
  if (order.printKits.some((k) => k.filesPurgedAt)) {
    throw new AuthzError(410, "The photos were deleted 60 days after delivery — nothing left to print");
  }
  if (!order.printKits.every(kitIsComplete)) {
    throw new AuthzError(409, "ছবি/কার্ড এখনো বাকি / Photos or cards are still missing — the PDF is made when every kit is ready");
  }
  return order;
}

/** The content hash of the order's print PDF (12 hex). */
export function printPdfHash(order: OrderForPrint, settings: PrintSettings): string {
  const kits = order.printKits.map((k) => [
    k.id,
    k.photos.map((p) => [p.id, p.originalPath, p.slot, p.position, normalizeCrop(p.crop)]),
    k.cards.map((c) => [c.slot, c.designId, c.design.updatedAt.toISOString(), c.text, c.toName, c.fromName]),
  ]);
  return createHash("sha256")
    .update(JSON.stringify([PDF_RENDER_VERSION, settings.layout, settings.sizes, infoFor(order), kits]))
    .digest("hex")
    .slice(0, 12);
}

const exists = async (file: string | null) => !!file && !!(await stat(file).catch(() => null))?.isFile();

/** Makes sure every photo's 300 DPI file matches today's sizes + crop, and
 *  every card PNG today's size + design; rebuilds what doesn't. */
async function ensureFiles(kit: KitRow, settings: PrintSettings) {
  const photos: { slot: PhotoSlot; position: number; file: string }[] = [];
  for (const p of kit.photos) {
    if (!p.slot || !p.position) continue;
    const slot = p.slot as PhotoSlot;
    const made = await makePrintFile({ ...p, crop: normalizeCrop(p.crop) }, slot, settings.sizes);
    if (made.printPath !== p.printPath) {
      await prisma.orderPrintPhoto.update({
        where: { id: p.id },
        data: { printPath: made.printPath, lowRes: made.lowRes },
      });
      await deletePrintFiles([p.printPath]);
    }
    photos.push({ slot, position: p.position, file: made.printPath });
  }

  const cards: { slot: CardSlot; file: string }[] = [];
  for (const c of kit.cards) {
    const slot = c.slot as CardSlot;
    const px = slotPixels(settings.sizes[slot]);
    const file = printFilePath(c.renderPath);
    let fresh = (await exists(file)) && c.updatedAt >= c.design.updatedAt;
    if (fresh) {
      const meta = await sharp(file!).metadata();
      fresh = meta.width === px.w && meta.height === px.h;
    }
    let renderPath = c.renderPath!;
    if (!fresh) {
      const card = await renderCard(
        designForRender(serializeCardDesign(c.design)),
        settings.sizes[slot],
        cardLines(c.text, { to: c.toName, from: c.fromName })
      );
      // The card fitted when it was chosen; a smaller size or text area since
      // then must not let the text run outside it on paper.
      if (!card.fits) {
        throw new AuthzError(
          409,
          `${c.slot === "CARD_1" ? "Card 1" : "Card 2"}: মেসেজটা আর কার্ডে আঁটছে না — Manager ছোট করুন / The message no longer fits this card after a design or size change — a Manager must shorten it`
        );
      }
      renderPath = await savePrintFile(`card-${randomUUID()}.png`, card.png);
      await prisma.orderPrintCard.update({
        where: { id: c.id },
        data: { renderPath, fontPt: card.fontPt },
      });
      await deletePrintFiles([c.renderPath]);
    }
    cards.push({ slot, file: renderPath });
  }
  return { photos, cards };
}

const building = new Map<string, Promise<string>>();

async function build(order: OrderForPrint, settings: PrintSettings, hash: string): Promise<string> {
  const kits = [];
  for (const k of order.printKits) kits.push(await ensureFiles(k, settings));
  const pages = planPrintPages(kits, PRINT_LAYOUTS[settings.layout], settings.sizes, infoFor(order));
  const pdf = await renderPrintPdf(pages, {
    readImage: async (name) => {
      const file = printFilePath(name);
      if (!file) throw new Error(`Missing print file ${name}`);
      return readFile(file);
    },
    renderInfo: renderInfoText,
  });
  return savePrintPdf(order.orderNo, hash, pdf);
}

/**
 * The order's print PDF on disk — the cached file when nothing changed,
 * else built now (once per hash, however many people click at the same time).
 * Throws 404 (no kit) / 409 (a kit not ready).
 */
export async function getOrderPrintPdf(orderId: number): Promise<{ file: string; hash: string; orderNo: string }> {
  const [order, settings] = await Promise.all([loadOrder(orderId), getPrintSettings()]);
  const hash = printPdfHash(order, settings);
  const file = printPdfPath(order.orderNo, hash);
  if (await exists(file)) return { file, hash, orderNo: order.orderNo };
  let job = building.get(hash);
  if (!job) {
    job = build(order, settings, hash).finally(() => building.delete(hash));
    building.set(hash, job);
  }
  return { file: await job, hash, orderNo: order.orderNo };
}

/** Builds the PDF ahead of time once the order's kits are all ready. Never
 *  throws — a kit that isn't ready yet, or a failed build, is simply skipped
 *  (the Print button builds it again). */
export async function warmPrintPdf(orderId: number): Promise<void> {
  try {
    await getOrderPrintPdf(orderId);
  } catch (e) {
    if (!(e instanceof AuthzError)) console.error(`Print PDF warm-up failed for order ${orderId}:`, e);
  }
}

/**
 * PP-7 "Mark printed": every live kit → PRINTED with who / when, +1 print
 * count and the hash of the PDF that was printed. A second time is a reprint
 * (allowed, logged as such).
 */
export async function markOrderPrinted(orderId: number, userId: number) {
  const [order, settings] = await Promise.all([loadOrder(orderId), getPrintSettings()]);
  const hash = printPdfHash(order, settings);
  const now = new Date();
  const reprint = order.printKits.some((k) => k.printCount > 0);
  await prisma.$transaction(async (tx) => {
    for (const k of order.printKits) {
      await tx.orderPrintKit.update({
        where: { id: k.id },
        data: {
          status: "PRINTED",
          printedAt: now,
          printedBy: userId,
          printCount: { increment: 1 },
          printHash: hash,
        },
      });
    }
    await logAuditTx(tx, {
      userId,
      action: reprint ? "print.reprinted" : "print.printed",
      entity: "orders",
      entityId: order.id,
      before: { kits: order.printKits.map((k) => ({ id: k.id, status: k.status, printCount: k.printCount })) },
      after: { orderNo: order.orderNo, pdfHash: hash, layout: settings.layout },
    });
  });
  return { reprint, printedAt: now.toISOString() };
}
