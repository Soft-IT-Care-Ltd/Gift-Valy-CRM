"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { PACKED_UNPRINTED_WARNING, type OrderPrintStatus } from "@/lib/print-kit";
import { PrintBar } from "@/components/orders/print/print-bar";
import {
  openInvoicePdf,
  openInvoicesPrintJob,
} from "@/components/orders/print/invoice-print-job";
import { ORDER_STATUS_LABELS, type OrderStatusValue } from "@/lib/order-constants";

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

/** PP-7 — the order's print state (shared with the order page). */
export type PackingPrint = OrderPrintStatus;

/** ROUND3 R3-3 — an order already packed and on its way (Packed, Handed to
 *  courier, In transit): what Packing needs to find it and reprint its
 *  invoice. No money, no customer abroad phone. */
export interface ShippingOrder {
  id: number;
  orderNo: string;
  status: OrderStatusValue;
  recipientName: string;
  recipientPhoneBd: string;
  area: string;
  deliveryDateMode: "ASAP" | "ANY_DAY" | "FIXED";
  requestedDeliveryDate: string | null;
  items: string[];
}

type Tab = "pack" | "shipping";

export function PackingQueueClient({
  queue,
  shipping,
  shippingCapped,
  canPrint,
  canPrintInvoices,
  borderless,
}: {
  queue: PackingOrder[];
  shipping: ShippingOrder[];
  shippingCapped: boolean;
  canPrint: boolean;
  /** R3-3 — single + bulk invoice print (invoice.print with orders.pack). */
  canPrintInvoices: boolean;
  borderless: boolean;
}) {
  const router = useRouter();
  const [packingId, setPackingId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("pack");
  // Selection for the bulk print — per tab, cleared when the tab changes.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [bulkPrinting, setBulkPrinting] = useState(false);

  const tabIds = tab === "pack" ? queue.map((o) => o.id) : shipping.map((o) => o.id);
  const selectedIds = tabIds.filter((id) => selected.has(id));
  const allSelected = tabIds.length > 0 && selectedIds.length === tabIds.length;

  function switchTab(next: Tab) {
    setTab(next);
    setSelected(new Set());
  }
  function toggle(id: number, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  async function printOne(id: number, orderNo: string) {
    setOpeningId(id);
    try {
      await openInvoicePdf(id, orderNo);
    } finally {
      setOpeningId(null);
    }
  }
  async function printSelected() {
    if (selectedIds.length === 0 || bulkPrinting) return;
    setBulkPrinting(true);
    try {
      await openInvoicesPrintJob(selectedIds);
    } finally {
      setBulkPrinting(false);
    }
  }

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
          {tab === "pack"
            ? queue.length === 0
              ? "No confirmed orders waiting to be packed."
              : `${queue.length} confirmed order${queue.length === 1 ? "" : "s"} waiting — ASAP first, then fixed dates, then flexible.`
            : shipping.length === 0
              ? "No packed orders on their way."
              : `${shipping.length} order${shipping.length === 1 ? "" : "s"} packed or with the courier — newest first.`}
        </p>
      </div>

      {/* R3-3 — tabs + the bulk invoice print for the selected rows */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border p-0.5">
          <Button
            size="sm"
            variant={tab === "pack" ? "default" : "ghost"}
            onClick={() => switchTab("pack")}
          >
            To pack ({queue.length})
          </Button>
          <Button
            size="sm"
            variant={tab === "shipping" ? "default" : "ghost"}
            onClick={() => switchTab("shipping")}
          >
            Packed &amp; with courier ({shipping.length}
            {shippingCapped ? "+" : ""})
          </Button>
        </div>
        {canPrintInvoices && tabIds.length > 0 && (
          <>
            <label className="ml-auto flex items-center gap-2 text-sm">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(v) =>
                  setSelected(v === true ? new Set(tabIds) : new Set())
                }
                aria-label="Select all orders on this tab"
              />
              Select all
            </label>
            <Button
              variant="outline"
              onClick={printSelected}
              disabled={selectedIds.length === 0 || bulkPrinting}
            >
              {bulkPrinting
                ? "Preparing…"
                : `Print invoices (${selectedIds.length})`}
            </Button>
          </>
        )}
      </div>

      {tab === "shipping" && (
        <Card>
          <CardContent className="pt-6">
            {shipping.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing packed or with the courier right now.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {canPrintInvoices && <TableHead className="w-8" />}
                    <TableHead>Order</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Deliver</TableHead>
                    {canPrintInvoices && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shipping.map((o) => (
                    <TableRow key={o.id}>
                      {canPrintInvoices && (
                        <TableCell>
                          <Checkbox
                            checked={selected.has(o.id)}
                            onCheckedChange={(v) => toggle(o.id, v === true)}
                            aria-label={`Select ${o.orderNo}`}
                          />
                        </TableCell>
                      )}
                      <TableCell className="font-medium whitespace-nowrap">
                        {o.orderNo}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {ORDER_STATUS_LABELS[o.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {o.recipientName}
                        <span className="block text-xs text-muted-foreground">
                          {o.recipientPhoneBd}
                          {o.area ? ` · ${o.area}` : ""}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[320px] text-sm">
                        {o.items.join(", ")}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {o.deliveryDateMode === "FIXED" && o.requestedDeliveryDate
                          ? formatDate(o.requestedDeliveryDate)
                          : o.deliveryDateMode === "ASAP"
                            ? "ASAP"
                            : "Any day"}
                      </TableCell>
                      {canPrintInvoices && (
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => printOne(o.id, o.orderNo)}
                            disabled={openingId === o.id}
                          >
                            {openingId === o.id ? "Opening…" : "Print invoice"}
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {shippingCapped && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing the newest {shipping.length}.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "pack" && queue.map((o) => {
        const shortage = o.pickList.some((l) => (l.onHand ?? 0) < l.qty);
        return (
          <Card key={o.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {canPrintInvoices && (
                    <Checkbox
                      checked={selected.has(o.id)}
                      onCheckedChange={(v) => toggle(o.id, v === true)}
                      aria-label={`Select ${o.orderNo}`}
                    />
                  )}
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
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                {canPrintInvoices && (
                  <Button
                    variant="outline"
                    onClick={() => printOne(o.id, o.orderNo)}
                    disabled={openingId === o.id}
                  >
                    {openingId === o.id ? "Opening…" : "Print invoice"}
                  </Button>
                )}
                <Button
                  onClick={() => markPacked(o)}
                  disabled={packingId === o.id || shortage}
                  title={shortage ? "Not enough stock on hand — purchase or adjust first" : undefined}
                >
                  {packingId === o.id ? "Packing…" : "Mark as PACKED"}
                </Button>
              </div>
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
                <PrintBar orderId={o.id} orderNo={o.orderNo} print={o.print} canPrint={canPrint} borderless={borderless} />
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
