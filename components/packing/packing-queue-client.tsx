"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/format";
import { PACKED_UNPRINTED_WARNING, type OrderPrintSummary } from "@/lib/print-kit";

export interface PickLine {
  sku: string;
  name: string;
  unit: string;
  qty: number;
  onHand: number | null; // null = per-order product (not stock-tracked)
}

// §2.2 — one line of an item's full BOM explosion, nesting preserved via
// depth: components with qty, chosen variants (choiceLabel set), packing
// materials (kind MATERIAL). Quantities are order totals (item qty included).
export interface BreakdownLine {
  depth: number;
  kind: "PRODUCT" | "PACKAGE" | "MATERIAL";
  name: string;
  sku: string | null;
  qty: number;
  unit: string;
  choiceLabel: string | null;
}

export interface PackingOrder {
  id: number;
  orderNo: string;
  createdAt: string;
  recipientName: string;
  recipientPhoneBd: string;
  district: string;
  thana: string;
  occasion: string | null;
  deliveryDateMode: "ASAP" | "ANY_DAY" | "FIXED";
  requestedDeliveryDate: string | null;
  lateRisk: boolean; // §3 — fixed date due today/tomorrow, still un-packed
  notes: string | null;
  courierNote: string | null;
  items: {
    name: string;
    isPackage: boolean;
    qty: number;
    breakdown: BreakdownLine[];
  }[];
  pickList: PickLine[];
  perOrderItems: PickLine[];
  /** PHOTO_PRINT PP-7 — null when the order has no photo kit. */
  print: PackingPrint | null;
}

export interface PackingPrint extends OrderPrintSummary {
  printedAt: string | null;
  printedBy: string | null;
  /** Most times any kit was printed (> 1 = reprinted). */
  printCount: number;
}

const PRINT_BADGE: Record<OrderPrintSummary["state"], string> = {
  PENDING: "border-amber-500 text-amber-700 dark:text-amber-300",
  READY: "border-sky-500 text-sky-700 dark:text-sky-300",
  PRINTED: "border-emerald-500 text-emerald-700 dark:text-emerald-300",
  CHANGED_AFTER_PRINT: "border-destructive text-destructive",
};

// PP-7 — the "Photos & cards" row of one order: state, the printing rule,
// Print (opens the cached PDF in a new tab) and Mark printed / reprinted.
function PrintRow({
  order,
  print,
  canPrint,
  borderless,
}: {
  order: PackingOrder;
  print: PackingPrint;
  canPrint: boolean;
  borderless: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const pending = print.state === "PENDING";

  async function markPrinted() {
    setBusy(true);
    const res = await fetch(`/api/orders/${order.id}/print-pdf/printed`, { method: "POST" });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(data?.error ?? "Failed to mark printed");
      return;
    }
    toast.success(data?.reprint ? `${order.orderNo} — reprint recorded` : `${order.orderNo} — marked printed`);
    router.refresh();
  }

  return (
    <div className="space-y-2 rounded-md border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">📷 Photos &amp; cards</span>
        <Badge variant="outline" className={PRINT_BADGE[print.state]}>
          {print.labelBn} / {print.label}
        </Badge>
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
            <Button asChild size="sm">
              <a href={`/api/orders/${order.id}/print-pdf`} target="_blank" rel="noopener">
                Print photos &amp; cards
              </a>
            </Button>
            <Button size="sm" variant="outline" onClick={markPrinted} disabled={busy}>
              {busy ? "Saving…" : print.printCount > 0 ? "Mark reprinted" : "Mark printed"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function PackingQueueClient({
  queue,
  canPrint,
  borderless,
}: {
  queue: PackingOrder[];
  canPrint: boolean;
  borderless: boolean;
}) {
  const router = useRouter();
  const [packingId, setPackingId] = useState<number | null>(null);

  async function markPacked(order: PackingOrder) {
    // PP-7 — not-printed photos/cards: a warning, never a block.
    const unprinted = order.print && order.print.state !== "PRINTED";
    const ask = `Mark ${order.orderNo} as PACKED? This deducts stock.`;
    if (!confirm(unprinted ? `${PACKED_UNPRINTED_WARNING}\n\n${ask}` : ask)) return;
    setPackingId(order.id);
    const res = await fetch(`/api/orders/${order.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "PACKED" }),
    });
    setPackingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to mark as packed");
      return;
    }
    toast.success(`${order.orderNo} packed — stock deducted`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Packing Queue</h1>
        <p className="text-sm text-muted-foreground">
          {queue.length === 0
            ? "No confirmed orders waiting to be packed."
            : `${queue.length} confirmed order${queue.length === 1 ? "" : "s"} waiting — ASAP first, then fixed dates, then flexible.`}
        </p>
      </div>

      {queue.map((o) => {
        const shortage = o.pickList.some((l) => (l.onHand ?? 0) < l.qty);
        return (
          <Card key={o.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {o.orderNo}
                  {shortage && <Badge variant="destructive">Stock short</Badge>}
                  {/* Delivery timing (CORRECTIONS Orders §1): fixed dates are
                      highlighted — pack these in the right priority order. */}
                  {o.deliveryDateMode === "FIXED" && o.requestedDeliveryDate && (
                    <Badge className="bg-violet-100 text-violet-800 hover:bg-violet-100 dark:bg-violet-950 dark:text-violet-300">
                      🎯 Deliver ON {formatDate(o.requestedDeliveryDate)}
                    </Badge>
                  )}
                  {/* §3 — late-risk: fixed date due today/tomorrow, not packed yet */}
                  {o.lateRisk && (
                    <Badge variant="destructive">⚠ At risk — deliver soon</Badge>
                  )}
                  {o.deliveryDateMode === "ASAP" && (
                    <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300">
                      ⚡ ASAP / Urgent
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Confirmed {formatDateTime(o.createdAt)} · To {o.recipientName} (
                  {o.recipientPhoneBd})
                  {[o.thana, o.district].filter(Boolean).length > 0 &&
                    ` · ${[o.thana, o.district].filter(Boolean).join(", ")}`}
                  {o.occasion ? ` · ${o.occasion}` : ""}
                </CardDescription>
              </div>
              <Button
                onClick={() => markPacked(o)}
                disabled={packingId === o.id || shortage}
                title={shortage ? "Not enough stock on hand — purchase or adjust first" : undefined}
              >
                {packingId === o.id ? "Packing…" : "Mark as PACKED"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* §2.2 — each item with its FULL BOM explosion: what goes
                  inside each package (components, chosen variants, packing
                  materials), indented by nesting level. The table below stays
                  the aggregated pick list with stock checks. */}
              <div className="grid gap-2 text-sm">
                {o.items.map((it, i) => (
                  <div key={i}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {it.qty} × {it.name}
                      </span>
                      {it.isPackage && (
                        <Badge variant="outline">package</Badge>
                      )}
                    </div>
                    {it.breakdown.length > 0 && (
                      <div className="mt-1 grid gap-0.5">
                        {it.breakdown.map((l, j) => (
                          <div
                            key={j}
                            className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
                            style={{ paddingLeft: `${16 + l.depth * 16}px` }}
                          >
                            <span
                              className={
                                l.kind === "MATERIAL" ? "" : "text-foreground"
                              }
                            >
                              {l.qty} × {l.name}
                            </span>
                            {l.sku && (
                              <span className="font-mono text-[10px]">
                                {l.sku}
                              </span>
                            )}
                            {l.choiceLabel && (
                              <Badge className="bg-violet-100 text-[10px] text-violet-800 hover:bg-violet-100 dark:bg-violet-950 dark:text-violet-300">
                                {l.choiceLabel}: chosen
                              </Badge>
                            )}
                            {l.kind === "MATERIAL" && (
                              <Badge
                                variant="outline"
                                className="text-[10px]"
                              >
                                packing material
                              </Badge>
                            )}
                            {l.kind === "PACKAGE" && (
                              <Badge
                                variant="secondary"
                                className="text-[10px]"
                              >
                                sub-package
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {o.print && (
                <PrintRow order={o} print={o.print} canPrint={canPrint} borderless={borderless} />
              )}
              {o.notes && (
                <div className="rounded-md bg-muted px-3 py-2 text-sm">
                  <span className="font-medium">Order note:</span> {o.notes}
                </div>
              )}
              {o.courierNote && (
                <div className="rounded-md bg-muted px-3 py-2 text-sm">
                  <span className="font-medium">Courier note:</span>{" "}
                  {o.courierNote}
                </div>
              )}

              {o.pickList.length > 0 && (
                <Table>
                  <caption className="mb-1 caption-top text-left text-xs font-medium text-muted-foreground">
                    Pick list — totals across the whole order
                  </caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Pick item</TableHead>
                      <TableHead className="text-right">Need</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {o.pickList.map((l) => (
                      <TableRow key={l.sku}>
                        <TableCell className="text-muted-foreground">{l.sku}</TableCell>
                        <TableCell className="font-medium">{l.name}</TableCell>
                        <TableCell className="text-right">
                          {l.qty} {l.unit}
                        </TableCell>
                        <TableCell className="text-right">{l.onHand}</TableCell>
                        <TableCell>
                          {(l.onHand ?? 0) < l.qty && (
                            <Badge variant="destructive">
                              short {l.qty - (l.onHand ?? 0)}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {o.perOrderItems.length > 0 && (
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Per-order (procure fresh):
                  </span>{" "}
                  {o.perOrderItems
                    .map((l) => `${l.qty} × ${l.name}`)
                    .join(", ")}{" "}
                  — not stock-tracked
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
