"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { money, formatDateTime } from "@/lib/format";
import { toCsv, downloadCsv, csvDateStamp } from "@/lib/csv";
import { STOCK_MOVEMENT_LABELS } from "@/lib/stock-constants";
import type { StockReportRow } from "@/lib/reports";

interface MovementRow {
  id: number;
  type: keyof typeof STOCK_MOVEMENT_LABELS;
  qty: number;
  at: string;
  reason: string | null;
  ref: { kind: string; label: string } | null;
  byUser: string | null;
}

export function StockReportClient({
  rows,
  totalStockValue,
  lowStockCount,
  showCosts,
}: {
  rows: StockReportRow[];
  totalStockValue: number | null;
  lowStockCount: number;
  showCosts: boolean;
}) {
  const [query, setQuery] = useState("");
  const [lowOnly, setLowOnly] = useState(false);

  // movement-history dialog (reuses the existing /api/stock/movements ledger)
  const [historyFor, setHistoryFor] = useState<StockReportRow | null>(null);
  const [movements, setMovements] = useState<MovementRow[] | null>(null);

  const trackedCount = useMemo(
    () => rows.filter((r) => r.isStockTracked).length,
    [rows]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (lowOnly && !r.isLow) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.sku.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
      );
    });
  }, [rows, query, lowOnly]);

  function exportStock() {
    const headers = [
      "SKU",
      "Product",
      "Category",
      "Unit",
      "Tracked",
      "Active",
      "On hand",
      "Reserved",
      "Available",
      "Low-stock threshold",
      "Low stock",
      ...(showCosts ? ["Avg cost", "Stock value"] : []),
    ];
    const body = rows.map((r) => [
      r.sku,
      r.name,
      r.category,
      r.unit,
      r.isStockTracked ? "yes" : "no",
      r.isActive ? "yes" : "no",
      r.isStockTracked ? r.stockQty : "",
      r.isStockTracked ? r.reservedQty : "",
      r.isStockTracked ? r.available : "",
      r.lowStockThreshold,
      r.isLow ? "yes" : "no",
      ...(showCosts ? [r.avgCost ?? 0, r.isStockTracked ? (r.stockValue ?? 0) : ""] : []),
    ]);
    downloadCsv(`stock-report-${csvDateStamp()}.csv`, toCsv(headers, body));
  }

  function exportLowStock() {
    const low = rows.filter((r) => r.isLow);
    const headers = ["SKU", "Product", "Category", "Available", "Threshold", "Unit"];
    const body = low.map((r) => [
      r.sku,
      r.name,
      r.category,
      r.available,
      r.lowStockThreshold,
      r.unit,
    ]);
    downloadCsv(`low-stock-${csvDateStamp()}.csv`, toCsv(headers, body));
  }

  async function openHistory(row: StockReportRow) {
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

  function exportMovements() {
    if (!historyFor || !movements) return;
    const headers = ["When", "Type", "Qty", "Ref", "Reason", "By"];
    const body = movements.map((m) => [
      formatDateTime(m.at),
      STOCK_MOVEMENT_LABELS[m.type] ?? m.type,
      m.qty,
      m.ref ? `${m.ref.kind}: ${m.ref.label}` : "",
      m.reason ?? "",
      m.byUser ?? "",
    ]);
    downloadCsv(
      `movements-${historyFor.sku}-${csvDateStamp()}.csv`,
      toCsv(headers, body)
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Stock report</h1>
          <p className="text-sm text-muted-foreground">
            R4 — on-hand, reserved, available and value per product, with the
            movement ledger.
          </p>
        </div>
        <Button variant="outline" onClick={exportStock}>
          Export CSV
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {totalStockValue != null && (
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total stock value (qty × avg cost)</CardDescription>
              <CardTitle className="text-2xl">{money(totalStockValue)}</CardTitle>
            </CardHeader>
          </Card>
        )}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Stock-tracked products</CardDescription>
            <CardTitle className="text-2xl">{trackedCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Low stock (available ≤ threshold)</CardDescription>
            <CardTitle className="text-2xl">{lowStockCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Low-stock alert list (SPEC §6.3) */}
      {lowStockCount > 0 && (
        <Card className="border-destructive/40">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-destructive">
                Low-stock alerts ({lowStockCount})
              </CardTitle>
              <CardDescription>
                Active tracked products at or below their reorder threshold.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={exportLowStock}>
              Export CSV
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Threshold</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows
                  .filter((r) => r.isLow)
                  .map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-muted-foreground">{r.sku}</TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>{r.category}</TableCell>
                      <TableCell className="text-right font-medium text-destructive">
                        {r.available} {r.unit}
                      </TableCell>
                      <TableCell className="text-right">{r.lowStockThreshold}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>All products</CardTitle>
              <CardDescription>
                On hand is physical stock; reserved is held by confirmed orders;
                available = on hand − reserved.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={lowOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setLowOnly((v) => !v)}
              >
                {lowOnly ? "Showing low stock" : "Low stock only"}
              </Button>
              <Input
                placeholder="Search SKU, name, category…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-56"
              />
            </div>
          </div>
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
                <TableHead className="text-right">History</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={showCosts ? 9 : 7}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No products match.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id} className={!r.isActive ? "opacity-50" : undefined}>
                    <TableCell className="text-muted-foreground">{r.sku}</TableCell>
                    <TableCell className="font-medium">
                      {r.name}
                      {!r.isStockTracked && (
                        <Badge variant="outline" className="ml-2">
                          per-order
                        </Badge>
                      )}
                      {r.isLow && (
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
                      <Button variant="outline" size="sm" onClick={() => openHistory(r)}>
                        History
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Movement ledger, newest first (SPEC §6.3) */}
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
            <>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={exportMovements}>
                  Export CSV
                </Button>
              </div>
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
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
