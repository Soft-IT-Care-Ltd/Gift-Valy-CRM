"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, formatDateTime } from "@/lib/format";
import { STOCK_MOVEMENT_LABELS } from "@/lib/stock-constants";

export interface StockRow {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  isStockTracked: boolean;
  isActive: boolean;
  stockQty: number;
  reservedQty: number;
  available: number;
  lowStockThreshold: number;
  avgCost?: number;
  stockValue?: number;
}

interface MovementRow {
  id: number;
  type: keyof typeof STOCK_MOVEMENT_LABELS;
  qty: number;
  at: string;
  reason: string | null;
  ref: { kind: string; label: string } | null;
  byUser: string | null;
}

export function StockClient({
  rows,
  showCosts,
  canAdjust,
}: {
  rows: StockRow[];
  showCosts: boolean;
  canAdjust: boolean;
}) {
  const router = useRouter();

  // adjust dialog
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);
  const [direction, setDirection] = useState<"PLUS" | "MINUS">("PLUS");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // movements dialog
  const [historyFor, setHistoryFor] = useState<StockRow | null>(null);
  const [movements, setMovements] = useState<MovementRow[] | null>(null);

  const tracked = rows.filter((r) => r.isStockTracked);
  const lowStock = tracked.filter(
    (r) => r.available <= r.lowStockThreshold && r.isActive
  );
  const totalValue = showCosts
    ? tracked.reduce((s, r) => s + (r.stockValue ?? 0), 0)
    : null;

  function openAdjust(row: StockRow) {
    setAdjusting(row);
    setDirection("PLUS");
    setQty("");
    setReason("");
  }

  async function saveAdjust() {
    if (!adjusting) return;
    setSaving(true);
    const res = await fetch("/api/stock/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: adjusting.id,
        direction,
        qty: Number(qty),
        reason: reason.trim(),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to adjust stock");
      return;
    }
    toast.success(`Stock adjusted for ${adjusting.name}`);
    setAdjusting(null);
    router.refresh();
  }

  async function openHistory(row: StockRow) {
    setHistoryFor(row);
    setMovements(null);
    const res = await fetch(`/api/stock/movements?productId=${row.id}`);
    if (!res.ok) {
      toast.error("Failed to load movements");
      setHistoryFor(null);
      return;
    }
    setMovements((await res.json()).movements);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {totalValue != null && (
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total stock value (qty × avg cost)</CardDescription>
              <CardTitle className="text-2xl">{money(totalValue)}</CardTitle>
            </CardHeader>
          </Card>
        )}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Stock-tracked products</CardDescription>
            <CardTitle className="text-2xl">{tracked.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Low stock (available ≤ threshold)</CardDescription>
            <CardTitle className="text-2xl">{lowStock.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stock</CardTitle>
          <CardDescription>
            On hand is physical stock; reserved is held by confirmed orders;
            available = on hand − reserved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Available</TableHead>
                {showCosts && <TableHead className="text-right">Avg cost</TableHead>}
                {showCosts && <TableHead className="text-right">Value</TableHead>}
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className={!r.isActive ? "opacity-50" : undefined}>
                  <TableCell className="text-muted-foreground">{r.sku}</TableCell>
                  <TableCell className="font-medium">
                    {r.name}
                    {!r.isStockTracked && (
                      <Badge variant="outline" className="ml-2">
                        per-order
                      </Badge>
                    )}
                    {r.isStockTracked &&
                      r.isActive &&
                      r.available <= r.lowStockThreshold && (
                        <Badge variant="destructive" className="ml-2">
                          low
                        </Badge>
                      )}
                  </TableCell>
                  <TableCell>{r.category}</TableCell>
                  <TableCell className="text-right">
                    {r.isStockTracked ? `${r.stockQty} ${r.unit}` : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.isStockTracked ? r.reservedQty : "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {r.isStockTracked ? r.available : "—"}
                  </TableCell>
                  {showCosts && (
                    <TableCell className="text-right">{money(r.avgCost ?? 0)}</TableCell>
                  )}
                  {showCosts && (
                    <TableCell className="text-right">
                      {r.isStockTracked ? money(r.stockValue ?? 0) : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => openHistory(r)}>
                        History
                      </Button>
                      {canAdjust && r.isStockTracked && (
                        <Button variant="outline" size="sm" onClick={() => openAdjust(r)}>
                          Adjust
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Manual adjust — SPEC §6.3: requires reason + stock.adjust, audit-logged */}
      <Dialog open={!!adjusting} onOpenChange={(o) => !o && setAdjusting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust stock — {adjusting?.name}</DialogTitle>
            <DialogDescription>
              On hand: {adjusting?.stockQty} {adjusting?.unit}. Adjustments write an
              immutable movement and the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Direction</Label>
                <Select
                  value={direction}
                  onValueChange={(v) => setDirection(v as "PLUS" | "MINUS")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PLUS">Add (+)</SelectItem>
                    <SelectItem value="MINUS">Remove (−)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Quantity</Label>
                <Input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Reason (required)</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. damaged in storage, physical count correction…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjusting(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveAdjust}
              disabled={saving || !Number(qty) || reason.trim().length < 3}
            >
              {saving ? "Saving…" : "Apply adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Movement ledger, newest first */}
      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Movements — {historyFor?.name}</DialogTitle>
            <DialogDescription>
              Immutable ledger, last 100 rows. Signed qty: + adds availability, − removes.
            </DialogDescription>
          </DialogHeader>
          {movements === null ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
          ) : movements.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No movements yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Ref / reason</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(m.at)}
                    </TableCell>
                    <TableCell>{STOCK_MOVEMENT_LABELS[m.type] ?? m.type}</TableCell>
                    <TableCell
                      className={`text-right font-medium ${m.qty < 0 ? "text-destructive" : "text-green-700"}`}
                    >
                      {m.qty > 0 ? `+${m.qty}` : m.qty}
                    </TableCell>
                    <TableCell className="max-w-56">
                      {m.ref && (
                        <Badge variant="secondary" className="mr-1">
                          {m.ref.kind === "order" ? m.ref.label : `PO: ${m.ref.label}`}
                        </Badge>
                      )}
                      {m.reason && (
                        <span className="text-sm text-muted-foreground">{m.reason}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.byUser ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
