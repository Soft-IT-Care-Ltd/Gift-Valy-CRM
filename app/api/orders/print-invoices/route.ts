import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermissionCtx, apiError, AuthzError } from "@/lib/authz";
import { orderScopeWhere } from "@/lib/orders";
import { orderIsInvoiceable } from "@/lib/order-constants";
import { getCurrencyForCountry } from "@/lib/currency";
import { getInvoiceBranding } from "@/lib/settings";
import {
  loadInvoiceOrders,
  renderInvoiceBatchPdf,
  type BatchInvoiceEntry,
} from "@/lib/invoice";

// CORRECTIONS Orders §6h — bulk invoice print from the CONFIRMED and PACKED
// tabs: multi-select → one PDF print job, two half-A4 invoices per page (§6i).
// This renders from CURRENT order data and creates no invoice rows — it is a
// print job, not a new invoice version; the versioned files stay the record.
export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  orderIds: z.array(z.number().int().positive()).min(1).max(100),
});

export async function POST(req: Request) {
  try {
    const { session, permissions } = await requirePermissionCtx("invoice.generate");
    const { orderIds } = bodySchema.parse(await req.json());

    // Scope first (SE own / TL team / Manager+Admin all) — ids outside the
    // caller's scope don't exist as far as they're concerned.
    const scope = await orderScopeWhere(session, permissions);
    const inScope = await prisma.order.findMany({
      where: { AND: [{ id: { in: orderIds } }, scope] },
      select: { id: true, orderNo: true, status: true },
    });
    const invoiceableIds = inScope
      .filter((o) => orderIsInvoiceable(o.status))
      .map((o) => o.id);
    if (invoiceableIds.length === 0) {
      throw new AuthzError(
        400,
        "None of the selected orders has an invoice — drafts/on-hold/cancelled orders are not invoiceable"
      );
    }

    const orders = await loadInvoiceOrders(invoiceableIds);

    // Latest version number per order (display only) + one currency lookup
    // per distinct country.
    const versions = await prisma.invoice.groupBy({
      by: ["orderId"],
      where: { orderId: { in: invoiceableIds } },
      _max: { version: true },
    });
    const versionByOrder = new Map(
      versions.map((v) => [v.orderId, v._max.version ?? 1])
    );
    const countries = [...new Set(orders.map((o) => o.customer.country))];
    const currencyByCountry = new Map(
      await Promise.all(
        countries.map(
          async (c) => [c, await getCurrencyForCountry(c)] as const
        )
      )
    );

    const entries: BatchInvoiceEntry[] = orders.map((order) => ({
      order,
      version: versionByOrder.get(order.id) ?? 1,
      currency: currencyByCountry.get(order.customer.country),
    }));
    const pdf = await renderInvoiceBatchPdf(entries, await getInvoiceBranding());

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `inline; filename="invoices-${entries.length}-orders.pdf"`,
        "Cache-Control": "private, no-store",
        // Selected-but-skipped count so the client can warn about partial jobs.
        "X-Skipped-Count": String(orderIds.length - entries.length),
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
