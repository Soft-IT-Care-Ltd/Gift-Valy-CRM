import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermissionCtx, apiError, AuthzError } from "@/lib/authz";
import {
  INVOICE_DIR,
  generateInvoice,
  invoiceFileName,
  loadInvoiceOrder,
  renderInvoicePdf,
} from "@/lib/invoice";
import { getCurrencyForCountry } from "@/lib/currency";
import { getInvoiceBranding } from "@/lib/settings";
import { orderScopeWhere } from "@/lib/orders";
import { orderIsInvoiceable } from "@/lib/order-constants";

type Params = { params: Promise<{ id: string }> };

// GET /api/orders/[id]/invoice[?version=N][&disposition=inline]
// Streams the invoice PDF — latest version by default, as a download; the
// print button and previews use disposition=inline. Confirmed orders that
// predate the invoice feature get v1 generated on first request.
export async function GET(req: Request, { params }: Params) {
  try {
    const { session, permissions } = await requirePermissionCtx("orders.view_own");
    const id = Number((await params).id);
    const scope = await orderScopeWhere(session, permissions);
    const order = await prisma.order.findFirst({
      where: { AND: [{ id }, scope] },
      select: { id: true, orderNo: true, status: true },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const sp = new URL(req.url).searchParams;
    const versionParam = Number(sp.get("version"));
    const inline = sp.get("disposition") === "inline";

    let invoice = versionParam
      ? await prisma.invoice.findUnique({
          where: { orderId_version: { orderId: id, version: versionParam } },
        })
      : await prisma.invoice.findFirst({
          where: { orderId: id },
          orderBy: { version: "desc" },
        });

    if (!invoice) {
      if (versionParam) {
        return NextResponse.json(
          { error: "Invoice version not found" },
          { status: 404 }
        );
      }
      if (!orderIsInvoiceable(order.status)) {
        throw new AuthzError(
          400,
          "No invoice yet — it is generated when the order is confirmed"
        );
      }
      if (!permissions.includes("invoice.generate")) {
        throw new AuthzError(403, "Missing permission: invoice.generate");
      }
      invoice = await generateInvoice(id, session.user.id);
    }

    const fileName = invoiceFileName(order.orderNo, invoice.version);
    let pdf: Buffer;
    try {
      pdf = await readFile(path.join(process.cwd(), invoice.pdfUrl));
    } catch {
      // File lost (fresh checkout / moved server). The latest version always
      // mirrors current order data — edits bump the version — so re-render
      // it; older versions capture superseded data and cannot be reproduced.
      const latest = await prisma.invoice.findFirst({
        where: { orderId: id },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      if (latest?.version !== invoice.version) {
        return NextResponse.json(
          { error: `The file for invoice v${invoice.version} is no longer available` },
          { status: 410 }
        );
      }
      const full = await loadInvoiceOrder(id);
      pdf = await renderInvoicePdf(
        full,
        invoice.version,
        await getCurrencyForCountry(full.customer.country),
        await getInvoiceBranding()
      );
      await mkdir(INVOICE_DIR, { recursive: true });
      await writeFile(path.join(INVOICE_DIR, fileName), pdf);
    }

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
