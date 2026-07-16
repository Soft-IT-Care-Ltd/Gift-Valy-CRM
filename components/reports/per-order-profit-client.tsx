"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DateFilter } from "@/components/ui/date-filter";
import { detectPreset } from "@/lib/date-filter";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { money, formatDate } from "@/lib/format";
import { toCsv, downloadCsv, csvDateStamp } from "@/lib/csv";
import { ExportPdfButton } from "@/components/reports/export-pdf-button";
import { ORDER_STATUS_LABELS, type OrderStatusValue } from "@/lib/order-constants";
import { AD_ALLOCATION_LABELS } from "@/lib/pnl-constants";
import { PnlNav } from "@/components/reports/pnl-nav";
import type { ReportPdfPayload } from "@/lib/report-pdf";
import type { PerOrderProfitReport, OrderProfitRow } from "@/lib/pnl";

export function PerOrderProfitClient({
  report,
  salesExecutives,
  from,
  to,
  se,
}: {
  report: PerOrderProfitReport;
  salesExecutives: { id: number; name: string }[];
  from: string;
  to: string;
  se: string;
}) {
  const router = useRouter();
  const [fromDate, setFromDate] = useState(from);
  const [toDate, setToDate] = useState(to);
  // Client-side status filter over the fetched rows. Default: real sales only.
  const [statusFilter, setStatusFilter] = useState("SALES");

  function pushParams(next: { se?: string; from?: string; to?: string }) {
    const params = new URLSearchParams();
    const f = next.from ?? fromDate;
    const t = next.to ?? toDate;
    if (f) params.set("from", f);
    if (t) params.set("to", t);
    const seVal = next.se ?? se;
    if (seVal) params.set("se", seVal);
    router.push(`/reports/pnl/orders${params.toString() ? `?${params}` : ""}`);
  }
  function resetRange() {
    setFromDate("");
    setToDate("");
    router.push("/reports/pnl/orders");
  }

  const statusesPresent = useMemo(
    () => [...new Set(report.rows.map((r) => r.status))],
    [report.rows]
  );

  const filtered = useMemo(() => {
    return report.rows.filter((r) => {
      if (statusFilter === "SALES") return r.isSale;
      if (statusFilter === "ALL") return true;
      return r.status === statusFilter;
    });
  }, [report.rows, statusFilter]);

  function exportCsv() {
    const headers = [
      "Order",
      "Date",
      "Sales Executive",
      "Customer",
      "District",
      "Status",
      "Sell value",
      "Product cost",
      "Courier cost",
      "Packaging",
      "Ad cost",
      "Profit",
      "Margin %",
      "Cost complete",
    ];
    const body = filtered.map((r) => [
      r.orderNo,
      formatDate(r.createdAt),
      r.salesExecutive,
      r.customerName,
      r.district,
      ORDER_STATUS_LABELS[r.status],
      r.sellValue,
      r.productCost,
      r.courierCost,
      r.packagingCost,
      r.adCost,
      r.profit,
      r.marginPct,
      r.hasCostSnapshot && r.hasCourierActual ? "yes" : "no",
    ]);
    downloadCsv(`per-order-profit-${csvDateStamp()}.csv`, toCsv(headers, body));
  }

  const rangeLabel = `${formatDate(report.range.from)} → ${formatDate(report.range.to)}`;
  const t = report.totals;

  function pdfPayload(): ReportPdfPayload {
    const seName = se
      ? salesExecutives.find((u) => String(u.id) === se)?.name ?? se
      : "";
    const statusLabel =
      statusFilter === "SALES"
        ? "Sales only"
        : statusFilter === "ALL"
          ? "All statuses"
          : ORDER_STATUS_LABELS[statusFilter as OrderStatusValue];
    const share = (value: number) =>
      `${t.sellValue > 0 ? Math.round((value / t.sellValue) * 100) : 0}%`;
    return {
      title: "Per-order Profit (R9)",
      subtitle: `${rangeLabel}${seName ? ` · SE: ${seName}` : ""} · Status: ${statusLabel}`,
      landscape: true,
      kpis: [
        { label: "Sales orders", value: String(t.orderCount) },
        { label: "Sell value", value: money(t.sellValue) },
        {
          label: "Total profit",
          value: `${money(t.profit)} · ${t.marginPct.toFixed(1)}% margin`,
        },
        { label: "Avg profit / order", value: money(t.avgProfit) },
      ],
      sections: [
        {
          heading: "Where the margin goes",
          note: `Totals across ${t.orderCount} sales orders in range. Ad allocation: ${AD_ALLOCATION_LABELS[report.adAllocationMethod]}${report.adAllocationMethod === "manual_percent" ? ` (${report.settings.adManualPercent}%)` : ""} · Packaging / order: ${money(report.settings.packagingCostPerOrder)}.`,
          headers: ["Line", "Amount", "% of sell value"],
          aligns: ["l", "r", "r"],
          rows: [
            ["Product cost", money(t.productCost), share(t.productCost)],
            ["Courier cost", money(t.courierCost), share(t.courierCost)],
            ["Packaging", money(t.packagingCost), share(t.packagingCost)],
            ["Ad cost", money(t.adCost), share(t.adCost)],
            ["Profit", money(t.profit), share(t.profit)],
          ],
        },
        {
          heading: `Orders (${filtered.length})`,
          note: `* = product cost or courier cost not yet frozen (order not packed / no shipment).${report.incompleteCostCount > 0 ? ` ${report.incompleteCostCount} sales order(s) don't have their full cost frozen yet — their profit is an estimate until packed / shipped.` : ""}`,
          headers: [
            "Order",
            "Date",
            "SE",
            "Status",
            "Sell",
            "Product",
            "Courier",
            "Pkg",
            "Ad",
            "Profit",
            "Margin",
          ],
          aligns: ["l", "l", "l", "l", "r", "r", "r", "r", "r", "r", "r"],
          rows: filtered.map((r) => [
            `${r.orderNo}${!r.hasCostSnapshot || !r.hasCourierActual ? " *" : ""}`,
            formatDate(r.createdAt),
            r.salesExecutive,
            ORDER_STATUS_LABELS[r.status],
            money(r.sellValue),
            r.hasCostSnapshot ? money(r.productCost) : "—",
            r.hasCourierActual ? money(r.courierCost) : "—",
            money(r.packagingCost),
            money(r.adCost),
            money(r.profit),
            `${r.marginPct.toFixed(1)}%`,
          ]),
        },
      ],
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Per-order profit</h1>
          <p className="text-sm text-muted-foreground">
            R9 (SPEC §9.2) — sell value − product cost − actual courier cost −
            packaging − allocated ad cost, per order.
          </p>
        </div>
        <ExportPdfButton
          filename={`per-order-profit-${csvDateStamp()}.pdf`}
          build={pdfPayload}
        />
      </div>

      <PnlNav />

      {/* Formula inputs in effect */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-6 text-sm">
          <span>
            <span className="text-muted-foreground">Ad allocation:</span>{" "}
            <span className="font-medium">
              {AD_ALLOCATION_LABELS[report.adAllocationMethod]}
              {report.adAllocationMethod === "manual_percent"
                ? ` (${report.settings.adManualPercent}%)`
                : ""}
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">Packaging / order:</span>{" "}
            <span className="font-medium">
              {money(report.settings.packagingCostPerOrder)}
            </span>
          </span>
          <Link
            href="/settings/pnl"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Change P&amp;L settings
          </Link>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <DateFilter
            value={detectPreset(fromDate, toDate, "month")}
            from={fromDate}
            to={toDate}
            onApply={(_preset, f, t) => {
              setFromDate(f);
              setToDate(t);
              pushParams({ from: f, to: t });
            }}
          />
          <div className="grid gap-1">
            <Label className="text-xs">Sales executive</Label>
            <Select
              value={se || "ALL"}
              onValueChange={(v) => pushParams({ se: v === "ALL" ? "" : v })}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All executives</SelectItem>
                {salesExecutives.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={resetRange}>
            Reset
          </Button>
          <span className="ml-auto self-center text-sm text-muted-foreground">
            Showing {rangeLabel}
          </span>
        </CardContent>
      </Card>

      {/* KPIs (over real sales — cancelled/returned/refunded excluded) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Sales orders" value={String(t.orderCount)} sub="excl. cancelled/returned" />
        <Kpi label="Sell value" value={money(t.sellValue)} />
        <Kpi
          label="Total profit"
          value={money(t.profit)}
          sub={`${t.marginPct.toFixed(1)}% margin`}
          tone={t.profit >= 0 ? "pos" : "neg"}
        />
        <Kpi label="Avg profit / order" value={money(t.avgProfit)} />
      </div>

      {/* Cost breakdown of the totals */}
      <Card>
        <CardHeader>
          <CardTitle>Where the margin goes</CardTitle>
          <CardDescription>
            Totals across {t.orderCount} sales orders in range.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <CostTile label="Product cost" value={t.productCost} of={t.sellValue} />
            <CostTile label="Courier cost" value={t.courierCost} of={t.sellValue} />
            <CostTile label="Packaging" value={t.packagingCost} of={t.sellValue} />
            <CostTile label="Ad cost" value={t.adCost} of={t.sellValue} />
            <CostTile label="Profit" value={t.profit} of={t.sellValue} highlight />
          </div>
        </CardContent>
      </Card>

      {/* Detail table */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Orders ({filtered.length})</CardTitle>
            <CardDescription>
              Profit per order. <span className="font-medium">*</span> = product
              cost or courier cost not yet frozen (order not packed / no shipment).
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SALES">Sales only (default)</SelectItem>
                <SelectItem value="ALL">All statuses</SelectItem>
                {statusesPresent.map((s) => (
                  <SelectItem key={s} value={s}>
                    {ORDER_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={filtered.length === 0}
            >
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>SE</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Sell</TableHead>
                  <TableHead className="text-right">Product</TableHead>
                  <TableHead className="text-right">Courier</TableHead>
                  <TableHead className="text-right">Pkg</TableHead>
                  <TableHead className="text-right">Ad</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <ProfitRow key={r.orderId} r={r} />
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="py-6 text-center text-muted-foreground">
                      No orders match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {report.incompleteCostCount > 0 && (
            <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
              {report.incompleteCostCount} sales order(s) don&apos;t have their full
              cost frozen yet — their profit is an estimate until packed / shipped.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProfitRow({ r }: { r: OrderProfitRow }) {
  const incomplete = !r.hasCostSnapshot || !r.hasCourierActual;
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap font-mono text-xs">
        <Link
          href={`/orders/${r.orderId}`}
          className="text-primary underline-offset-4 hover:underline"
        >
          {r.orderNo}
        </Link>
        {incomplete && <span title="Cost not fully frozen"> *</span>}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatDate(r.createdAt)}
      </TableCell>
      <TableCell className="whitespace-nowrap">{r.salesExecutive}</TableCell>
      <TableCell>
        <Badge variant={r.isSale ? "secondary" : "outline"} className="text-[10px]">
          {ORDER_STATUS_LABELS[r.status]}
        </Badge>
      </TableCell>
      <TableCell className="text-right">{money(r.sellValue)}</TableCell>
      <TableCell className="text-right text-muted-foreground">
        {r.hasCostSnapshot ? money(r.productCost) : "—"}
      </TableCell>
      <TableCell className="text-right text-muted-foreground">
        {r.hasCourierActual ? money(r.courierCost) : "—"}
      </TableCell>
      <TableCell className="text-right text-muted-foreground">
        {money(r.packagingCost)}
      </TableCell>
      <TableCell className="text-right text-muted-foreground">
        {money(r.adCost)}
      </TableCell>
      <TableCell
        className={`text-right font-medium ${
          r.profit < 0 ? "text-red-600 dark:text-red-400" : ""
        }`}
      >
        {money(r.profit)}
      </TableCell>
      <TableCell
        className={`text-right text-sm ${
          r.marginPct < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
        }`}
      >
        {r.marginPct.toFixed(1)}%
      </TableCell>
    </TableRow>
  );
}

function CostTile({
  label,
  value,
  of,
  highlight,
}: {
  label: string;
  value: number;
  of: number;
  highlight?: boolean;
}) {
  const share = of > 0 ? Math.round((value / of) * 100) : 0;
  return (
    <div
      className={`rounded-lg border p-3 ${
        highlight ? "border-primary/40 bg-primary/5" : ""
      }`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-semibold ${
          highlight && value < 0 ? "text-red-600 dark:text-red-400" : ""
        }`}
      >
        {money(value)}
      </div>
      <div className="text-xs text-muted-foreground">{share}% of sell value</div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg";
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={`text-2xl ${
            tone === "neg" ? "text-red-600 dark:text-red-400" : ""
          }`}
        >
          {value}
        </CardTitle>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardHeader>
    </Card>
  );
}
