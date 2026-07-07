"use client";

import { useMemo, useState } from "react";
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
import { money } from "@/lib/format";
import { toCsv, downloadCsv, csvDateStamp } from "@/lib/csv";
import type { PackageReportRow } from "@/lib/reports";

// null buildable = every component is per-order (no stock constraint).
const buildableLabel = (n: number | null) => (n === null ? "Unlimited" : String(n));

export function PackageReportClient({
  rows,
  showCosts,
}: {
  rows: PackageReportRow[];
  showCosts: boolean;
}) {
  const [query, setQuery] = useState("");
  const [detailFor, setDetailFor] = useState<PackageReportRow | null>(null);

  const outOfStock = useMemo(
    () => rows.filter((r) => r.isActive && r.buildable === 0).length,
    [rows]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)
    );
  }, [rows, query]);

  function exportPackages() {
    const headers = [
      "Code",
      "Package",
      "Active",
      "Components",
      "Buildable qty",
      "Limited by",
      "Selling price",
      ...(showCosts ? ["Cost", "Margin"] : []),
    ];
    const body = rows.map((r) => [
      r.code,
      r.name,
      r.isActive ? "yes" : "no",
      r.componentCount,
      buildableLabel(r.buildable),
      r.limitedBy ?? "",
      r.sellingPrice,
      ...(showCosts ? [r.cost ?? 0, r.margin ?? 0] : []),
    ]);
    downloadCsv(`package-availability-${csvDateStamp()}.csv`, toCsv(headers, body));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Package availability</h1>
          <p className="text-sm text-muted-foreground">
            R5 — buildable quantity per package = min over BOM components of ⌊stock
            ÷ qty required⌋.
          </p>
        </div>
        <Button variant="outline" onClick={exportPackages}>
          Export CSV
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Packages</CardDescription>
            <CardTitle className="text-2xl">{rows.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cannot build any (active)</CardDescription>
            <CardTitle className="text-2xl">{outOfStock}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Packages</CardTitle>
              <CardDescription>
                Open a package to see which component limits it and what to restock.
              </CardDescription>
            </div>
            <Input
              placeholder="Search code or name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-56"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Package</TableHead>
                <TableHead className="text-right">Buildable</TableHead>
                <TableHead>Limited by</TableHead>
                <TableHead className="text-right">Price</TableHead>
                {showCosts && <TableHead className="text-right">Cost</TableHead>}
                {showCosts && <TableHead className="text-right">Margin</TableHead>}
                <TableHead className="text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={showCosts ? 8 : 6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No packages match.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id} className={!r.isActive ? "opacity-50" : undefined}>
                    <TableCell className="text-muted-foreground">{r.code}</TableCell>
                    <TableCell className="font-medium">
                      {r.name}
                      {!r.isActive && (
                        <Badge variant="outline" className="ml-2">
                          inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {r.buildable === 0 ? (
                        <Badge variant="destructive">0</Badge>
                      ) : (
                        buildableLabel(r.buildable)
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.limitedBy ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">{money(r.sellingPrice)}</TableCell>
                    {showCosts && (
                      <TableCell className="text-right">{money(r.cost ?? 0)}</TableCell>
                    )}
                    {showCosts && (
                      <TableCell className="text-right">{money(r.margin ?? 0)}</TableCell>
                    )}
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setDetailFor(r)}>
                        BOM
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* BOM breakdown — per-component stock and how many packages each supports */}
      <Dialog open={!!detailFor} onOpenChange={(o) => !o && setDetailFor(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detailFor?.name}</DialogTitle>
            <DialogDescription>
              Buildable now: {detailFor ? buildableLabel(detailFor.buildable) : ""}
              {detailFor?.limitedBy ? ` · limited by ${detailFor.limitedBy}` : ""}
            </DialogDescription>
          </DialogHeader>
          {detailFor && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead className="text-right">Qty / pkg</TableHead>
                  <TableHead className="text-right">In stock</TableHead>
                  <TableHead className="text-right">Supports</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailFor.components.map((c) => {
                  const binding =
                    detailFor.buildable !== null &&
                    c.buildableFrom === detailFor.buildable;
                  return (
                    <TableRow key={c.sku}>
                      <TableCell className="font-medium">
                        {c.productName}
                        {!c.isStockTracked && (
                          <Badge variant="outline" className="ml-2">
                            per-order
                          </Badge>
                        )}
                        {binding && (
                          <Badge variant="destructive" className="ml-2">
                            limiting
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{c.qtyPerPackage}</TableCell>
                      <TableCell className="text-right">
                        {c.isStockTracked ? `${c.stockQty} ${c.unit}` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {c.buildableFrom === null ? "∞" : c.buildableFrom}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
