"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DateFilter } from "@/components/ui/date-filter";
import { detectPreset } from "@/lib/date-filter";
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
import { money, formatDate } from "@/lib/format";
import { toCsv, downloadCsv, csvDateStamp } from "@/lib/csv";
import { ExportPdfButton } from "@/components/reports/export-pdf-button";
import type { ReportPdfPayload } from "@/lib/report-pdf";
import type { DamagedStockReport } from "@/lib/reports";

// CORRECTIONS Orders §6n — the damaged-stock report client. One row per
// damage-log entry (product, qty, order ref, date, inspector); cost/loss
// columns render only when the server included them (cost-visible roles).
export function DamagedReportClient({
  report,
  showCosts,
  from,
  to,
}: {
  report: DamagedStockReport;
  showCosts: boolean;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [fromDate, setFromDate] = useState(from);
  const [toDate, setToDate] = useState(to);

  function applyRange(f: string, t: string) {
    const params = new URLSearchParams();
    if (f) params.set("from", f);
    if (t) params.set("to", t);
    router.push(`/reports/damaged${params.toString() ? `?${params}` : ""}`);
  }

  function exportCsv() {
    const headers = [
      "Date",
      "SKU",
      "Product",
      "Qty",
      "Order",
      "Inspector",
      "Note",
      ...(showCosts ? ["Unit cost", "Loss value"] : []),
    ];
    const body = report.rows.map((r) => [
      formatDate(r.inspectedAt),
      r.sku,
      r.productName,
      r.qty,
      r.orderNo ?? "",
      r.inspector,
      r.note ?? "",
      ...(showCosts ? [r.unitCost ?? 0, r.lossValue ?? 0] : []),
    ]);
    downloadCsv(`damaged-stock-${csvDateStamp()}.csv`, toCsv(headers, body));
  }

  function pdfPayload(): ReportPdfPayload {
    return {
      title: "Damaged Stock Report",
      subtitle:
        fromDate || toDate
          ? `${fromDate || "…"} → ${toDate || "…"}`
          : "All time",
      sections: [
        {
          heading: "Damaged items",
          note: "Marked damaged at return receive — never restocked; value at cost is a P&L loss.",
          headers: [
            "Date",
            "Product",
            "Qty",
            "Order",
            "Inspector",
            ...(showCosts ? ["Loss"] : []),
          ],
          aligns: ["l", "l", "r", "l", "l", ...(showCosts ? ["r" as const] : [])],
          rows: report.rows.map((r) => [
            formatDate(r.inspectedAt),
            `${r.productName} (${r.sku})`,
            r.qty,
            r.orderNo ?? "—",
            r.inspector,
            ...(showCosts ? [money(r.lossValue ?? 0)] : []),
          ]),
        },
      ],
    };
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Damaged Stock</h1>
          <p className="text-sm text-muted-foreground">
            Items marked damaged during return receive — excluded from sellable
            stock{showCosts ? "; their at-cost value counts as a P&L loss" : ""}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            Export CSV
          </Button>
          <ExportPdfButton
            filename={`damaged-stock-${csvDateStamp()}.pdf`}
            build={pdfPayload}
          />
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <DateFilter
            showAllTime
            value={detectPreset(fromDate, toDate, "all")}
            from={fromDate}
            to={toDate}
            onApply={(preset, f, t) => {
              const nf = preset === "all" ? "" : f;
              const nt = preset === "all" ? "" : t;
              setFromDate(nf);
              setToDate(nt);
              applyRange(nf, nt);
            }}
          />
          <span className="ml-auto self-center text-sm text-muted-foreground">
            {report.rows.length} entr{report.rows.length === 1 ? "y" : "ies"} ·{" "}
            {report.totalQty} unit{report.totalQty === 1 ? "" : "s"}
            {showCosts && report.totalLoss != null && (
              <> · total loss {money(report.totalLoss)}</>
            )}
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Damage log</CardTitle>
          <CardDescription>
            Recorded at receive-time inspection (who received, what was damaged).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Inspector</TableHead>
                <TableHead>Note</TableHead>
                {showCosts && <TableHead className="text-right">Unit cost</TableHead>}
                {showCosts && <TableHead className="text-right">Loss</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(r.inspectedAt)}
                  </TableCell>
                  <TableCell>
                    {r.productName}
                    <div className="font-mono text-xs text-muted-foreground">
                      {r.sku}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{r.qty}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.orderNo ?? "—"}
                  </TableCell>
                  <TableCell>{r.inspector}</TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                    {r.note ?? "—"}
                  </TableCell>
                  {showCosts && (
                    <TableCell className="text-right">
                      {money(r.unitCost ?? 0)}
                    </TableCell>
                  )}
                  {showCosts && (
                    <TableCell className="text-right font-medium">
                      {money(r.lossValue ?? 0)}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {report.rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={showCosts ? 8 : 6}
                    className="text-center text-muted-foreground"
                  >
                    No damaged items in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
