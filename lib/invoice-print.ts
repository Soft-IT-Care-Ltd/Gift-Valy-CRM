import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import { AuthzError } from "./authz";
import { orderScopeWhere, orderViewScope } from "./orders";
import { orderIsInvoiceable, type OrderStatusValue } from "./order-constants";
import { getCurrencyForCountry } from "./currency";
import { getInvoiceBranding } from "./settings";
import { invoicePdfPath, saveInvoicePdf } from "./file-storage";
import {
  generateInvoice,
  invoiceFileName,
  loadInvoiceOrder,
  loadInvoiceOrders,
  renderInvoiceBatchPdf,
  renderInvoicePdf,
  type BatchInvoiceEntry,
} from "./invoice";

// ============ ROUND3 R3-3 — who may open / print an invoice ============
//
//   your order scope   orders.view_own / _team / _all — exactly as before R3-3
//                      (an SE: own orders; TL: team; Manager/Admin: all), any
//                      invoiceable status.
//   the Packing queue  invoice.print + orders.pack — every order in the
//                      Packing queue's statuses (Confirmed → In transit),
//                      whoever sold it. invoice.print WITHOUT orders.pack adds
//                      nothing to a person's order scope, so the SEs who get it
//                      (every role with invoice.generate does) can still only
//                      print their own orders.
//
// Generating a new invoice version stays with invoice.generate. A Packing user
// opening an order that has no invoice row yet gets the current data rendered
// on the spot (like the bulk print) — no row, no file, no new version.
//
// Route logic lives here, taking the session context and a db client, so the
// tests run it inside a rolled-back transaction; the routes only bind it.

export const PACKING_PRINT_STATUSES: OrderStatusValue[] = [
  "CONFIRMED",
  "PACKED",
  "HANDED_TO_COURIER",
  "IN_TRANSIT",
];

export const PACKING_PRINT_REFUSED =
  "Packing can print invoices only for orders in the Packing queue (Confirmed, Packed, Handed to courier, In transit)";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface PrintCtx {
  session: Session;
  permissions: string[];
}

/** Any invoice print at all (the buttons on the Orders tabs + Packing screen). */
export function canPrintInvoices(permissions: string[]): boolean {
  return permissions.includes("invoice.print") || permissions.includes("invoice.generate");
}

/** invoice.print reaches the whole Packing queue only together with orders.pack. */
export function hasPackingPrintReach(permissions: string[]): boolean {
  return permissions.includes("invoice.print") && permissions.includes("orders.pack");
}

export interface InvoicePrintScope {
  where: Prisma.OrderWhereInput;
  /** No order view scope — reach is the Packing queue only (403 outside it). */
  packingOnly: boolean;
}

/** The orders this person may print invoices for, or 403. */
export async function invoicePrintScope(ctx: PrintCtx): Promise<InvoicePrintScope> {
  const view = orderViewScope(ctx.permissions);
  const packing = hasPackingPrintReach(ctx.permissions);
  if (!view && !packing) throw new AuthzError(403, "Missing permission: invoice.print");
  const parts: Prisma.OrderWhereInput[] = [];
  if (view) parts.push(await orderScopeWhere(ctx.session, ctx.permissions));
  if (packing) parts.push({ status: { in: PACKING_PRINT_STATUSES } });
  return { where: parts.length === 1 ? parts[0] : { OR: parts }, packingOnly: !view };
}

const pdfResponse = (pdf: Buffer, disposition: string, extra: Record<string, string> = {}) =>
  new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": disposition,
      "Cache-Control": "private, no-store",
      ...extra,
    },
  });

// GET /api/orders/[id]/invoice[?version=N][&disposition=inline]
// Streams the invoice PDF — latest version by default, as a download; the
// print buttons and previews use disposition=inline. Confirmed orders that
// predate the invoice feature get v1 generated on first request (with
// invoice.generate) or a print of the current data (Packing).
export async function invoicePdfHandler(
  req: Request,
  ctx: PrintCtx,
  id: number,
  db: Tx = prisma
): Promise<NextResponse> {
  const scope = await invoicePrintScope(ctx);
  const order = await db.order.findFirst({
    where: { AND: [{ id }, scope.where] },
    select: { id: true, orderNo: true, status: true },
  });
  if (!order) {
    // Packing sees the whole queue, so naming the rule leaks nothing.
    if (scope.packingOnly && (await db.order.findFirst({ where: { id }, select: { id: true } }))) {
      throw new AuthzError(403, PACKING_PRINT_REFUSED);
    }
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const sp = new URL(req.url).searchParams;
  const versionParam = Number(sp.get("version"));
  const inline = sp.get("disposition") === "inline";
  const disposition = (fileName: string) =>
    `${inline ? "inline" : "attachment"}; filename="${fileName}"`;

  let invoice = versionParam
    ? await db.invoice.findUnique({
        where: { orderId_version: { orderId: id, version: versionParam } },
      })
    : await db.invoice.findFirst({
        where: { orderId: id },
        orderBy: { version: "desc" },
      });

  if (!invoice) {
    if (versionParam) {
      return NextResponse.json({ error: "Invoice version not found" }, { status: 404 });
    }
    if (!orderIsInvoiceable(order.status)) {
      throw new AuthzError(400, "No invoice yet — it is generated when the order is confirmed");
    }
    if (!ctx.permissions.includes("invoice.generate")) {
      if (
        !hasPackingPrintReach(ctx.permissions) ||
        !PACKING_PRINT_STATUSES.includes(order.status)
      ) {
        throw new AuthzError(403, "Missing permission: invoice.generate");
      }
      // R3-3 — print the current data; creating a version stays with
      // invoice.generate.
      const full = await loadInvoiceOrder(id, db);
      const pdf = await renderInvoicePdf(
        full,
        1,
        await getCurrencyForCountry(full.customer.country),
        await getInvoiceBranding()
      );
      return pdfResponse(pdf, disposition(invoiceFileName(order.orderNo, 1)));
    }
    invoice = await generateInvoice(id, ctx.session.user.id);
  }

  const fileName = invoiceFileName(order.orderNo, invoice.version);
  let pdf: Buffer;
  try {
    pdf = await readFile(invoicePdfPath(invoice.pdfUrl));
  } catch {
    // File lost (fresh checkout / moved server). The latest version always
    // mirrors current order data — edits bump the version — so re-render
    // it; older versions capture superseded data and cannot be reproduced.
    const latest = await db.invoice.findFirst({
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
    const full = await loadInvoiceOrder(id, db);
    pdf = await renderInvoicePdf(
      full,
      invoice.version,
      await getCurrencyForCountry(full.customer.country),
      await getInvoiceBranding()
    );
    await saveInvoicePdf(fileName, pdf);
  }
  return pdfResponse(pdf, disposition(fileName));
}

const bulkBodySchema = z.object({
  orderIds: z.array(z.number().int().positive()).min(1).max(100),
});

// POST /api/orders/print-invoices — CORRECTIONS Orders §6h bulk print: one PDF,
// two half-A4 invoices per page (§6i), from CURRENT order data; creates no
// invoice rows. Selected orders outside the person's reach are skipped (the
// count goes back in X-Skipped-Count); a Packing user whose selection holds
// none of the queue's orders gets 403.
export async function printInvoicesHandler(
  req: Request,
  ctx: PrintCtx,
  db: Tx = prisma
): Promise<NextResponse> {
  if (!canPrintInvoices(ctx.permissions)) {
    throw new AuthzError(403, "Missing permission: invoice.print");
  }
  const { orderIds } = bulkBodySchema.parse(await req.json());
  const scope = await invoicePrintScope(ctx);
  const inScope = await db.order.findMany({
    where: { AND: [{ id: { in: orderIds } }, scope.where] },
    select: { id: true, orderNo: true, status: true },
  });
  const invoiceableIds = inScope.filter((o) => orderIsInvoiceable(o.status)).map((o) => o.id);
  if (invoiceableIds.length === 0) {
    if (scope.packingOnly) throw new AuthzError(403, PACKING_PRINT_REFUSED);
    throw new AuthzError(
      400,
      "None of the selected orders has an invoice — drafts/on-hold/cancelled orders are not invoiceable"
    );
  }

  const orders = await loadInvoiceOrders(invoiceableIds, db);

  // Latest version number per order (display only) + one currency lookup per
  // distinct country.
  const versions = await db.invoice.groupBy({
    by: ["orderId"],
    where: { orderId: { in: invoiceableIds } },
    _max: { version: true },
  });
  const versionByOrder = new Map(versions.map((v) => [v.orderId, v._max.version ?? 1]));
  const countries = [...new Set(orders.map((o) => o.customer.country))];
  const currencyByCountry = new Map(
    await Promise.all(countries.map(async (c) => [c, await getCurrencyForCountry(c)] as const))
  );

  const entries: BatchInvoiceEntry[] = orders.map((order) => ({
    order,
    version: versionByOrder.get(order.id) ?? 1,
    currency: currencyByCountry.get(order.customer.country),
  }));
  const pdf = await renderInvoiceBatchPdf(entries, await getInvoiceBranding());
  return pdfResponse(pdf, `inline; filename="invoices-${entries.length}-orders.pdf"`, {
    // Selected-but-skipped count so the client can warn about partial jobs.
    "X-Skipped-Count": String(orderIds.length - entries.length),
  });
}
