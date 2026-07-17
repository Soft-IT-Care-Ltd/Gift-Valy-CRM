"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// CORRECTIONS Orders §6n — the receive-time damage inspection. Opens for one or
// many returned orders: each order's BOM-exploded items load from
// GET /api/shipments/{id}/return-receive; the inspector marks damaged units per
// item (OK = qty − damaged, the default). Submitting posts one receive per
// shipment: OK units restock instantly, damaged units go to the damage log +
// P&L loss. No Admin approval step — this action IS the approval.

interface InspectionItem {
  productId: number;
  name: string;
  sku: string;
  unit: string;
  qty: number;
}

interface InspectionSheet {
  shipmentId: number;
  orderId: number;
  orderNo: string;
  items: InspectionItem[];
  error?: string; // load failure — the order is skipped on submit
}

export interface ReceiveTarget {
  orderId: number;
  orderNo: string;
  shipmentId: number;
}

export function ReturnReceiveDialog({
  targets,
  onClose,
  onDone,
}: {
  targets: ReceiveTarget[] | null; // null = closed
  onClose: () => void;
  onDone: () => void; // at least one receive succeeded — refresh the list
}) {
  const [sheets, setSheets] = useState<InspectionSheet[] | null>(null);
  // damaged qty per `${shipmentId}:${productId}` — inputs keep strings
  const [damaged, setDamaged] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<
    { orderNo: string; ok: boolean; detail: string }[] | null
  >(null);

  // Reset per target set during render ("reset state on prop change" pattern —
  // no effect-body setState, no extra paint with stale sheets).
  const targetsKey = targets ? targets.map((t) => t.shipmentId).join(",") : "";
  const [prevTargetsKey, setPrevTargetsKey] = useState(targetsKey);
  if (prevTargetsKey !== targetsKey) {
    setPrevTargetsKey(targetsKey);
    setSheets(null);
    setDamaged({});
    setNote("");
    setResults(null);
  }

  useEffect(() => {
    if (!targets || targets.length === 0) return;
    let cancelled = false;
    (async () => {
      const loaded = await Promise.all(
        targets.map(async (t): Promise<InspectionSheet> => {
          try {
            const res = await fetch(`/api/shipments/${t.shipmentId}/return-receive`);
            const data = await res.json().catch(() => null);
            if (!res.ok) {
              return {
                shipmentId: t.shipmentId,
                orderId: t.orderId,
                orderNo: t.orderNo,
                items: [],
                error: data?.error ?? "Failed to load the inspection sheet",
              };
            }
            return {
              shipmentId: t.shipmentId,
              orderId: t.orderId,
              orderNo: t.orderNo,
              items: (data.items ?? []) as InspectionItem[],
            };
          } catch {
            return {
              shipmentId: t.shipmentId,
              orderId: t.orderId,
              orderNo: t.orderNo,
              items: [],
              error: "Failed to load the inspection sheet",
            };
          }
        })
      );
      if (!cancelled) setSheets(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [targets]);

  function damagedFor(shipmentId: number, productId: number): number {
    const raw = damaged[`${shipmentId}:${productId}`];
    const n = Number(raw);
    return raw != null && raw !== "" && Number.isFinite(n) ? Math.floor(n) : 0;
  }

  const totalDamaged = (sheets ?? []).reduce(
    (s, sheet) =>
      s + sheet.items.reduce((t, it) => t + damagedFor(sheet.shipmentId, it.productId), 0),
    0
  );
  const invalid = (sheets ?? []).some((sheet) =>
    sheet.items.some((it) => {
      const d = damagedFor(sheet.shipmentId, it.productId);
      return d < 0 || d > it.qty;
    })
  );

  async function submit() {
    if (!sheets || busy || invalid) return;
    setBusy(true);
    try {
      const outcomes: { orderNo: string; ok: boolean; detail: string }[] = [];
      for (const sheet of sheets) {
        if (sheet.error) {
          outcomes.push({ orderNo: sheet.orderNo, ok: false, detail: sheet.error });
          continue;
        }
        const res = await fetch(`/api/shipments/${sheet.shipmentId}/return-receive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: sheet.items.map((it) => ({
              productId: it.productId,
              damagedQty: damagedFor(sheet.shipmentId, it.productId),
            })),
            note: note.trim() || null,
          }),
        });
        const data = await res.json().catch(() => null);
        outcomes.push({
          orderNo: sheet.orderNo,
          ok: res.ok,
          detail: res.ok
            ? `${data?.restoredQty ?? 0} back to stock${
                (data?.damagedQty ?? 0) > 0 ? `, ${data.damagedQty} damaged` : ""
              }`
            : (data?.error ?? "Failed"),
        });
      }
      const okCount = outcomes.filter((o) => o.ok).length;
      if (okCount > 0) {
        toast.success(
          `${okCount} return${okCount === 1 ? "" : "s"} received — OK items are back in stock`
        );
        onDone();
      }
      if (okCount === outcomes.length) {
        onClose();
      } else {
        setResults(outcomes);
        if (okCount === 0) toast.error("No returns were received — see details");
      }
    } finally {
      setBusy(false);
    }
  }

  const open = targets !== null && targets.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {results ? "Receive results" : "Receive returned parcels"}
          </DialogTitle>
          <DialogDescription>
            {results
              ? "OK items are back in sellable stock; damaged items are in the damage log."
              : "Inspect every item. OK items go back to sellable stock immediately; anything marked damaged is logged (never restocked) and its cost counts as a loss."}
          </DialogDescription>
        </DialogHeader>

        {results ? (
          <div className="max-h-[50vh] overflow-auto rounded-md border">
            <Table>
              <TableBody>
                {results.map((r) => (
                  <TableRow key={r.orderNo}>
                    <TableCell className="font-mono text-xs">{r.orderNo}</TableCell>
                    <TableCell className="text-xs">
                      {r.ok ? (
                        <span className="text-green-700">✓ {r.detail}</span>
                      ) : (
                        <span className="text-destructive">✗ {r.detail}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : !sheets ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading inspection sheets…
          </p>
        ) : (
          <div className="grid max-h-[55vh] gap-4 overflow-auto">
            {sheets.map((sheet) => (
              <div key={sheet.shipmentId} className="rounded-md border">
                <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
                  <span className="font-mono text-xs font-medium">{sheet.orderNo}</span>
                  {sheet.error ? (
                    <Badge variant="outline" className="bg-red-100 text-red-800">
                      {sheet.error}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {sheet.items.length} item{sheet.items.length === 1 ? "" : "s"} expected back
                    </span>
                  )}
                </div>
                {!sheet.error && sheet.items.length === 0 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    Nothing is out on this order&apos;s stock ledger — receiving it
                    only marks the parcel as back.
                  </p>
                )}
                {sheet.items.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="w-28 text-right">Damaged</TableHead>
                        <TableHead className="text-right">OK → stock</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sheet.items.map((it) => {
                        const d = damagedFor(sheet.shipmentId, it.productId);
                        const bad = d < 0 || d > it.qty;
                        return (
                          <TableRow key={it.productId}>
                            <TableCell>
                              <div className="text-sm">{it.name}</div>
                              <div className="font-mono text-[11px] text-muted-foreground">
                                {it.sku}
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {it.qty} {it.unit}
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min={0}
                                max={it.qty}
                                step={1}
                                className={cn(
                                  "ml-auto h-8 w-20 text-right text-xs",
                                  bad && "border-destructive"
                                )}
                                value={damaged[`${sheet.shipmentId}:${it.productId}`] ?? ""}
                                placeholder="0"
                                onChange={(e) =>
                                  setDamaged((prev) => ({
                                    ...prev,
                                    [`${sheet.shipmentId}:${it.productId}`]: e.target.value,
                                  }))
                                }
                              />
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right text-sm",
                                bad ? "text-destructive" : "text-muted-foreground"
                              )}
                            >
                              {bad ? "—" : it.qty - d}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            ))}
            <div className="grid gap-1.5">
              <Label className="text-xs">Inspection note (optional)</Label>
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. box crushed in transit — logged on damaged items"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {results ? "Close" : "Cancel"}
          </Button>
          {!results && (
            <Button onClick={submit} disabled={busy || !sheets || invalid}>
              {busy
                ? "Receiving…"
                : totalDamaged > 0
                  ? `Receive — ${totalDamaged} damaged`
                  : "Receive — all OK"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
