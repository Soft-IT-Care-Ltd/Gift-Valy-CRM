import { prisma } from "./db";
import { deletePrintFiles } from "./file-storage";
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
