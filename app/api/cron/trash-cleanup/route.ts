import path from "path";
import { unlink } from "fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { timingSafeEqual } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { getSystemUserId } from "@/lib/system-user";
import { TRASH_RETENTION_DAYS } from "@/lib/order-constants";

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
    if (expired.length === 0) {
      return NextResponse.json({ ok: true, purged: 0 });
    }

    const systemUserId = await getSystemUserId(prisma);
    const purged: string[] = [];
    for (const order of expired) {
      // PDF files first — a failed unlink must not block the row purge
      // (files carry PII, but an orphaned file is better than a zombie order).
      for (const inv of order.invoices) {
        try {
          await unlink(path.join(process.cwd(), inv.pdfUrl));
        } catch {
          // already gone / fresh checkout — nothing to clean
        }
      }
      await prisma.order.delete({ where: { id: order.id } });
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
    return NextResponse.json({ ok: true, purged: purged.length, orders: purged });
  } catch (e) {
    console.error("Trash cleanup failed:", e);
    return NextResponse.json({ ok: false, error: "Cleanup failed" }, { status: 500 });
  }
}
