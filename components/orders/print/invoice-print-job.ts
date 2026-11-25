import { toast } from "sonner";

// Invoice print jobs from the browser — shared by the Orders tabs (CORRECTIONS
// Orders §6h) and the Packing screen (ROUND3 R3-3). The PDF is fetched first
// so a refusal (403, nothing printable) shows as a message instead of a JSON
// page, then opened in a new tab where the person prints it.

function openPdf(blob: Blob) {
  window.open(URL.createObjectURL(blob), "_blank");
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return data?.error ?? fallback;
}

/** One order's invoice (latest version), opened for printing. */
export async function openInvoicePdf(orderId: number, orderNo: string): Promise<boolean> {
  const res = await fetch(`/api/orders/${orderId}/invoice?disposition=inline`);
  if (!res.ok) {
    toast.error(await errorOf(res, `Couldn't open the invoice for ${orderNo}`));
    return false;
  }
  openPdf(await res.blob());
  return true;
}

/** Bulk: one PDF, two half-A4 invoices per A4 page. */
/** The bulk endpoint's limit (lib/invoice-print.ts bulkBodySchema). */
export const MAX_PRINT_JOB_ORDERS = 100;

export async function openInvoicesPrintJob(orderIds: number[]): Promise<boolean> {
  if (orderIds.length > MAX_PRINT_JOB_ORDERS) {
    toast.error(`Print at most ${MAX_PRINT_JOB_ORDERS} invoices at a time — ${orderIds.length} are selected.`);
    return false;
  }
  const res = await fetch("/api/orders/print-invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderIds }),
  });
  if (!res.ok) {
    toast.error(await errorOf(res, "Failed to build the print job"));
    return false;
  }
  const skipped = Number(res.headers.get("X-Skipped-Count") ?? 0);
  openPdf(await res.blob());
  const count = orderIds.length - skipped;
  toast.success(
    `Print job ready — ${count} invoice${count === 1 ? "" : "s"} on ${Math.ceil(count / 2)} A4 page${count > 2 ? "s" : ""}`
  );
  if (skipped > 0) {
    toast.warning(`${skipped} selected order${skipped === 1 ? "" : "s"} had nothing to print`);
  }
  return true;
}
