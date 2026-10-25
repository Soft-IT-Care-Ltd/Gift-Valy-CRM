"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { OrderPrintStatus } from "@/lib/print-kit";

// PHOTO_PRINT.md PP-7 — an order's "Photos & cards" print bar, on the Packing
// queue and on the order page: the state, a clear "Printed" mark once it was
// printed (when, by whom, how many times), and Print — which stays available
// after printing ("Print again"), next to Mark printed / Mark reprinted.

const PRINT_BADGE: Record<OrderPrintStatus["state"], string> = {
  PENDING: "border-amber-500 text-amber-700 dark:text-amber-300",
  READY: "border-sky-500 text-sky-700 dark:text-sky-300",
  PRINTED: "border-emerald-500 text-emerald-700 dark:text-emerald-300",
  CHANGED_AFTER_PRINT: "border-destructive text-destructive",
};

export function PrintBar({
  orderId,
  orderNo,
  print,
  canPrint,
  borderless,
}: {
  orderId: number;
  orderNo: string;
  print: OrderPrintStatus;
  /** print.print — may open the PDF and mark it printed. */
  canPrint: boolean;
  borderless: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const pending = print.state === "PENDING";
  const printed = print.printCount > 0;

  async function markPrinted() {
    setBusy(true);
    const res = await fetch(`/api/orders/${orderId}/print-pdf/printed`, { method: "POST" });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(data?.error ?? "Failed to mark printed");
      return;
    }
    toast.success(data?.reprint ? `${orderNo} — reprint recorded` : `${orderNo} — marked printed`);
    router.refresh();
  }

  return (
    <div
      className={`space-y-2 rounded-md border px-3 py-2 ${
        print.state === "PRINTED" ? "border-emerald-500/60 bg-emerald-50/60 dark:bg-emerald-950/20" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">📷 Photos &amp; cards</span>
        {print.state === "PRINTED" ? (
          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">✓ প্রিন্ট হয়েছে / Printed</Badge>
        ) : (
          <Badge variant="outline" className={PRINT_BADGE[print.state]}>
            {print.labelBn} / {print.label}
          </Badge>
        )}
        {print.printedAt && (
          <span className="text-xs text-muted-foreground">
            {print.printCount > 1 ? `Printed ${print.printCount}×, last` : "Printed"}{" "}
            {formatDateTime(print.printedAt)}
            {print.printedBy ? ` by ${print.printedBy}` : ""}
          </span>
        )}
      </div>
      {canPrint && !pending && (
        <>
          <p className="text-xs text-muted-foreground">
            A4 ফটো পেপার · 100% / Actual size — কখনো &quot;Fit to page&quot; নয়
            {borderless ? " · Borderless চালু রাখুন" : ""}
            <br />
            A4 photo paper · print at 100% / Actual size — never &quot;Fit to page&quot;
            {borderless ? " · Borderless on (2-page layout)" : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant={printed && print.state === "PRINTED" ? "outline" : "default"}>
              <a href={`/api/orders/${orderId}/print-pdf`} target="_blank" rel="noopener">
                {printed ? "🖨 আবার প্রিন্ট / Print again" : "🖨 Print photos & cards"}
              </a>
            </Button>
            <Button size="sm" variant="outline" onClick={markPrinted} disabled={busy}>
              {busy ? "Saving…" : printed ? "Mark reprinted" : "✓ Mark printed"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
