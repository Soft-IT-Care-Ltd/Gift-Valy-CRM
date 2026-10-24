import { prisma } from "./db";
import { deletePrintFiles, deletePrintPdfs } from "./file-storage";
import { previewName } from "./print-photos";

// PHOTO_PRINT.md PP-4 — housekeeping for customer photos (nightly
// trash-cleanup cron; never while suspended — the cron already holds then).

/** Photos uploaded on an order form that was never saved. */
export const STAGED_PHOTO_TTL_HOURS = 24;

/** Every file name belonging to an order's kits (photos + rendered cards). */
export async function orderPrintFiles(orderId: number): Promise<string[]> {
  const kits = await prisma.orderPrintKit.findMany({
    where: { orderId },
    select: {
      photos: { select: { originalPath: true, printPath: true } },
      cards: { select: { renderPath: true } },
    },
  });
  return kits.flatMap((k) => [
    ...k.photos.flatMap((p) => [p.originalPath, previewName(p.originalPath), p.printPath ?? ""]),
    ...k.cards.map((c) => c.renderPath ?? ""),
  ]).filter(Boolean);
}

/** Deletes staged photos older than the TTL (rows + files). */
export async function purgeStagedPhotos(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STAGED_PHOTO_TTL_HOURS * 60 * 60 * 1000);
  const stale = await prisma.orderPrintPhoto.findMany({
    where: { kitId: null, createdAt: { lt: cutoff } },
    select: { id: true, originalPath: true, printPath: true },
  });
  if (stale.length === 0) return 0;
  await prisma.orderPrintPhoto.deleteMany({ where: { id: { in: stale.map((p) => p.id) }, kitId: null } });
  await deletePrintFiles(stale.flatMap((p) => [p.originalPath, previewName(p.originalPath), p.printPath]));
  return stale.length;
}

/** PP-7 — customer photos are kept this long after delivery / return. */
export const PRINT_FILES_KEEP_DAYS = 60;

/**
 * Deletes the photos (original, preview, print file), rendered cards and the
 * cached print PDF of every kit whose order was delivered or returned more
 * than 60 days ago, and stamps files_purged_at. The rows stay (the order still
 * shows what was in the box); only the private files go.
 */
export async function purgeDeliveredPrintFiles(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PRINT_FILES_KEEP_DAYS * 24 * 60 * 60 * 1000);
  const kits = await prisma.orderPrintKit.findMany({
    where: {
      filesPurgedAt: null,
      // Delivered / returned (status history — panel-sent parcels have no
      // shipment row) and still in a post-delivery status. The LATEST
      // delivery / return counts: a parcel returned 70 days ago and sent
      // again keeps its photos until 60 days after that second delivery.
      order: {
        status: { in: ["DELIVERED", "COMPLETED", "RETURNED", "REFUNDED"] },
        statusHistory: {
          some: { toStatus: { in: ["DELIVERED", "RETURNED"] }, at: { lt: cutoff } },
          none: { toStatus: { in: ["DELIVERED", "RETURNED"] }, at: { gte: cutoff } },
        },
      },
    },
    select: {
      id: true,
      order: { select: { orderNo: true } },
      photos: { select: { originalPath: true, printPath: true } },
      cards: { select: { renderPath: true } },
    },
  });
  for (const k of kits) {
    await deletePrintFiles([
      ...k.photos.flatMap((p) => [p.originalPath, previewName(p.originalPath), p.printPath]),
      ...k.cards.map((c) => c.renderPath),
    ]);
    await deletePrintPdfs(k.order.orderNo);
    await prisma.orderPrintKit.update({ where: { id: k.id }, data: { filesPurgedAt: now } });
  }
  return kits.length;
}
