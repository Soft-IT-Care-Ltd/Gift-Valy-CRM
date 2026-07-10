"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, formatDate } from "@/lib/format";
import { toCsv, downloadCsv, csvDateStamp } from "@/lib/csv";
import { PnlNav } from "@/components/reports/pnl-nav";
import type { DailySummary, DailySummaryRow } from "@/lib/pnl";

export function DailySummaryClient({
  summary,
  from,
  to,
}: {
  summary: DailySummary;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [fromDate, setFromDate] = useState(from);
  const [toDate, setToDate] = useState(to);

  function applyRange() {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    router.push(`/reports/pnl/daily${params.toString() ? `?${params}` : ""}`);
  }
  function resetRange() {
    setFromDate("");
    setToDate("");
    router.push("/reports/pnl/daily");
  }

  function exportCsv() {
    const headers = ["Date", "Orders", "Sales", "Collection", "Costs", "Net"];
    const body = summary.rows.map((r) => [
      r.date,
      r.orders,
      r.salesValue,
      r.collection,
      r.costs,
      r.net,
    ]);
    body.push([
      "TOTAL",
      summary.totals.orders,
      summary.totals.salesValue,
      summary.totals.collection,
      summary.totals.costs,
      summary.totals.net,
    ]);
    downloadCsv(`daily-summary-${csvDateStamp()}.csv`, toCsv(headers, body));
  }

  const rangeLabel = `${formatDate(summary.range.from)} → ${formatDate(summary.range.to)}`;
  const t = summary.totals;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Daily summary</h1>
        <p className="text-sm text-muted-foreground">
          R9 (SPEC §9.3) — date-wise sales, collection, costs and net. Sales are
          booked at confirmation; collection and costs are cash (by payment/expense
          date). Net = Sales − Costs.
        </p>
      </div>

      <PnlNav />

      {/* Date range */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="grid gap-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-40"
            />
          </div>
          <Button onClick={applyRange}>Apply</Button>
          <Button variant="outline" onClick={resetRange}>
            This month
          </Button>
          <span className="ml-auto self-center text-sm text-muted-foreground">
            Showing {rangeLabel}
          </span>
        </CardContent>
      </Card>

      {/* Headline KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Orders" value={String(t.orders)} sub="confirmed sales" />
        <Kpi label="Sales value" value={money(t.salesValue)} />
        <Kpi label="Collection" value={money(t.collection)} sub="cash received" />
        <Kpi label="Costs" value={money(t.costs)} sub="expenses paid" />
        <Kpi
          label="Net (sales − costs)"
          value={money(t.net)}
          tone={t.net >= 0 ? "pos" : "neg"}
        />
      </div>

      {/* Sales vs costs chart */}
      <Card>
        <CardHeader>
          <CardTitle>Sales vs costs</CardTitle>
          <CardDescription>
            Daily sales value against costs paid over {rangeLabel}
            {summary.continuous ? "" : " · long range: only active days shown"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DailyChart rows={summary.rows} peak={summary.peakValue} />
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-primary/80" />
              Sales
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-amber-400" />
              Costs
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>By day</CardTitle>
            <CardDescription>{summary.rows.length} days in range.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={summary.rows.length === 0}
          >
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Collection</TableHead>
                  <TableHead className="text-right">Costs</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.rows.map((r) => (
                  <TableRow key={r.date}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {formatDate(r.date)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {r.orders || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.salesValue ? money(r.salesValue) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.collection ? money(r.collection) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.costs ? money(r.costs) : "—"}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        r.net < 0 ? "text-red-600 dark:text-red-400" : ""
                      }`}
                    >
                      {r.net ? money(r.net) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {summary.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                      No activity in this range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              {summary.rows.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="text-right font-semibold">
                      {t.orders}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {money(t.salesValue)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {money(t.collection)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {money(t.costs)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold ${
                        t.net < 0 ? "text-red-600 dark:text-red-400" : ""
                      }`}
                    >
                      {money(t.net)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Grouped sales/costs bars — self-contained SVG (matches the R8 ad-cost chart
// style). Theme-aware via currentColor / tailwind fills.
function DailyChart({ rows, peak }: { rows: DailySummaryRow[]; peak: number }) {
  if (rows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        No activity in this range.
      </div>
    );
  }

  const W = 760;
  const H = 240;
  const padL = 12;
  const padR = 12;
  const padT = 18;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const yMax = Math.max(peak, 1);
  const slotW = plotW / rows.length;
  const barW = Math.max(1, (slotW * 0.72) / 2);
  const gap = Math.max(0.5, slotW * 0.06);
  const labelStep = Math.max(1, Math.ceil(rows.length / 13));
  const baselineY = padT + plotH;
  const dayOfMonth = (ymd: string) => ymd.slice(8, 10);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-60 w-full min-w-[520px]"
        role="img"
        aria-label="Daily sales versus costs"
      >
        <g className="text-muted-foreground">
          <line
            x1={padL}
            y1={padT}
            x2={W - padR}
            y2={padT}
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.35}
          />
          <text x={padL} y={padT - 5} fontSize={10} fill="currentColor">
            ৳{yMax.toLocaleString("en-IN")}
          </text>
          <line
            x1={padL}
            y1={baselineY}
            x2={W - padR}
            y2={baselineY}
            stroke="currentColor"
            strokeWidth={1}
            opacity={0.4}
          />
        </g>

        {rows.map((d, i) => {
          const cx = padL + i * slotW + slotW / 2;
          const salesH = (d.salesValue / yMax) * plotH;
          const costsH = (d.costs / yMax) * plotH;
          return (
            <g key={d.date}>
              <rect
                className="text-primary"
                x={cx - barW - gap / 2}
                y={baselineY - salesH}
                width={barW}
                height={Math.max(0, salesH)}
                rx={1.5}
                fill="currentColor"
                opacity={0.85}
              >
                <title>{`${d.date} · Sales ৳${d.salesValue.toLocaleString("en-IN")}`}</title>
              </rect>
              <rect
                x={cx + gap / 2}
                y={baselineY - costsH}
                width={barW}
                height={Math.max(0, costsH)}
                rx={1.5}
                className="fill-amber-400"
              >
                <title>{`${d.date} · Costs ৳${d.costs.toLocaleString("en-IN")}`}</title>
              </rect>
            </g>
          );
        })}

        <g className="text-muted-foreground">
          {rows.map((d, i) =>
            i % labelStep === 0 ? (
              <text
                key={d.date}
                x={padL + i * slotW + slotW / 2}
                y={H - 10}
                fontSize={10}
                textAnchor="middle"
                fill="currentColor"
              >
                {dayOfMonth(d.date)}
              </text>
            ) : null
          )}
        </g>
      </svg>
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
