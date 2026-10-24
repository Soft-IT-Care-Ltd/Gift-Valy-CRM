import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { apiError, requirePermission } from "@/lib/authz";
import { getOrderPrintPdf } from "@/lib/print-pdf-build";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// PHOTO_PRINT.md PP-6 / PP-7 — the order's photos + cards PDF (print.print).
// Cached by content hash in INVOICE_DIR/print/, built on first open if the
// warm-up has not made it yet. 409 while a kit still misses photos or cards.
export async function GET(_req: Request, { params }: Params) {
  try {
    await requirePermission("print.print");
    const { file, orderNo, hash } = await getOrderPrintPdf(Number((await params).id));
    const pdf = await readFile(file);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `inline; filename="${orderNo}-photos-cards.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Print-Hash": hash,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
