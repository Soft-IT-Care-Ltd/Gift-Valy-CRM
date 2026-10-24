import { unlink } from "fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { invoicePdfPath } from "@/lib/file-storage";
import { timingSafeEqual } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { getSystemUserId } from "@/lib/system-user";
import { TRASH_RETENTION_DAYS } from "@/lib/order-constants";
import { readPlatformState } from "@/lib/platform/state";
import { LOCK_CODE, LOCK_ERROR } from "@/lib/platform/lock";
import { deletePrintFiles, deletePrintPdfs } from "@/lib/file-storage";
import { orderPrintFiles, purgeDeliveredPrintFiles, purgeStagedPhotos } from "@/lib/print-cleanup";

// CORRECTIONS Orders §6f — scheduled purge: orders trashed more than 30 days
// ago are deleted permanently. Row deletion cascades to items, payments,
// status history, edit requests, invoices, WhatsApp logs and the shipment;
// invoice PDF files are removed from storage/ first. Stock-movement ledger
// rows are kept — the ledger is immutable and the trash action already
// released anything the order held. Secured by CRON_SECRET like the
// Steadfast poll (vercel.json runs it daily).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const presented = req.headers.get("authorization");
  if (!secret || !presented || !timingSafeEqual(presented, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // FUNNEL_LINER.md GV-7 — nothing is deleted from a locked system. proxy.ts
    // already answers 423 here; this reads the stored state uncached so the
    // purge also holds when the proxy's cached read fell back to "active".
    // Cutoff-based, so it catches up without double counting once lifted.
    if ((await readPlatformState(prisma)).state === "suspended") {
      return NextResponse.json({ error: LOCK_ERROR, code: LOCK_CODE }, { status: 423 });
    }
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    // Explicit deletedAt filter opts out of the lib/db.ts trash auto-filter.
    const expired = await prisma.order.findMany({
      where: { deletedAt: { not: null, lt: cutoff } },
      select: {
        id: true,
        orderNo: true,
        deletedAt: true,
        invoices: { select: { pdfUrl: true } },
      },
    });
    // PHOTO_PRINT PP-4 — photos uploaded on an order form that was never saved.
    const stagedPhotos = await purgeStagedPhotos();
    // PP-7 — photos, cards and print PDFs 60 days after delivery / return.
    const printKitsPurged = await purgeDeliveredPrintFiles();
    if (expired.length === 0) {
      return NextResponse.json({ ok: true, purged: 0, stagedPhotos, printKitsPurged });
    }

    const systemUserId = await getSystemUserId(prisma);
    const purged: string[] = [];
    for (const order of expired) {
      // PDF files first — a failed unlink must not block the row purge
      // (files carry PII, but an orphaned file is better than a zombie order).
      for (const inv of order.invoices) {
        try {
          await unlink(invoicePdfPath(inv.pdfUrl));
        } catch {
          // already gone / fresh checkout — nothing to clean
        }
      }
      // PHOTO_PRINT PP-4 — the customer photos and cards go with the order
      // (their rows cascade; the files are removed right after).
      const printFiles = await orderPrintFiles(order.id);
      await prisma.order.delete({ where: { id: order.id } });
      await deletePrintFiles(printFiles);
      await deletePrintPdfs(order.orderNo);
      await logAudit({
        userId: systemUserId,
        action: "order.purge",
        entity: "orders",
        entityId: order.id,
        before: {
          orderNo: order.orderNo,
          deletedAt: order.deletedAt?.toISOString(),
        },
        after: { purgedAfterDays: TRASH_RETENTION_DAYS },
      });
      purged.push(order.orderNo);
    }
    return NextResponse.json({ ok: true, purged: purged.length, orders: purged, stagedPhotos, printKitsPurged });
  } catch (e) {
    console.error("Trash cleanup failed:", e);
    return NextResponse.json({ ok: false, error: "Cleanup failed" }, { status: 500 });
  }
}
