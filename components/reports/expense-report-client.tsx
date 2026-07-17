"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
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
import {
  COST_TYPE_LABELS,
  autoExpenseSource,
  type ExpenseRow,
} from "@/lib/expense-constants";
import type { ReportPdfPayload, ReportPdfSection } from "@/lib/report-pdf";
import type { ExpenseReport, AdCostDay } from "@/lib/reports";

export function ExpenseReportClient({
  report,
  from,
  to,
}: {
  report: ExpenseReport;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [fromDate, setFromDate] = useState(from);
  const [toDate, setToDate] = useState(to);

  // Detail-list filters (client-side over the fetched rows).
  const [fCategory, setFCategory] = useState("ALL");
  const [fSource, setFSource] = useState("ALL");

  function applyRange(f: string, t: string) {
    const params = new URLSearchParams();
    if (f) params.set("from", f);
    if (t) params.set("to", t);
    router.push(`/reports/expenses${params.toString() ? `?${params}` : ""}`);
  }

  const filtered = useMemo(() => {
    return report.expenses.filter((e) => {
      if (fCategory !== "ALL" && String(e.categoryId) !== fCategory) return false;
      if (fSource === "MANUAL" && e.isAuto) return false;
      if (fSource === "AUTO" && !e.isAuto) return false;
      return true;
    });
  }, [report.expenses, fCategory, fSource]);

  function exportDetail() {
    const headers = [
      "Date",
      "Category",
      "Type",
      "Wallet",
      "Campaign",
      "Notes",
      "Source",
      "Amount",
    ];
    const body = filtered.map((e) => [
      formatDate(e.expenseDate),
      e.categoryName,
      COST_TYPE_LABELS[e.costType],
      e.walletName ?? "",
      e.campaignName ?? "",
      e.notes ?? "",
      autoExpenseSource(e.refTable)?.label ?? "Manual",
      e.amount,
    ]);
    downloadCsv(`expenses-${csvDateStamp()}.csv`, toCsv(headers, body));
  }

  function exportByCategory() {
    const headers = ["Category", "Type", "Amount", "Share %", "Entries"];
    const body = report.byCategory.map((c) => [
      c.name,
      COST_TYPE_LABELS[c.costType],
      c.amount,
      c.share,
      c.count,
    ]);
    downloadCsv(`expenses-by-category-${csvDateStamp()}.csv`, toCsv(headers, body));
  }

  const fixedPct =
    report.total > 0 ? Math.round((report.fixedTotal / report.total) * 100) : 0;
  const rangeLabel = `${formatDate(report.range.from)} → ${formatDate(report.range.to)}`;
  const maxCatAmount = report.byCategory[0]?.amount ?? 0;

  function pdfPayload(): ReportPdfPayload {
    const detailFilters = [
      fCategory !== "ALL"
        ? `Category: ${report.byCategory.find((c) => String(c.categoryId) === fCategory)?.name ?? fCategory}`
        : null,
      fSource === "MANUAL" ? "Manual only" : fSource === "AUTO" ? "Auto only" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    // Chart data as a table — on continuous series, zero-spend days are noise.
    const adDaily = report.adCost.dailyContinuous
      ? report.adCost.daily.filter((d) => d.amount > 0)
      : report.adCost.daily;

    const sections: ReportPdfSection[] = [
      {
        heading: "By category",
        note: "Where the money went, largest first.",
        headers: ["Category", "Type", "Share %", "Entries", "Amount"],
        aligns: ["l", "l", "r", "r", "r"],
        rows: report.byCategory.map((c) => [
          c.name,
          COST_TYPE_LABELS[c.costType],
          `${c.share}%`,
          c.count,
          money(c.amount),
        ]),
      },
    ];
    if (adDaily.length > 0) {
      sections.push({
        heading: "Ad cost — daily trend",
        note: `${money(report.adCost.total)} total ad spend${
          report.adCost.dailyContinuous
            ? " · zero-spend days omitted"
            : " · long range: only days with spend are shown"
        }.`,
        headers: ["Date", "Amount"],
        aligns: ["l", "r"],
        rows: adDaily.map((d) => [d.date, money(d.amount)]),
      });
    }
    if (report.adCost.byCampaign.length > 0) {
      sections.push({
        heading: "Ad cost by campaign",
        headers: ["Campaign", "Entries", "Amount"],
        aligns: ["l", "r", "r"],
        rows: report.adCost.byCampaign.map((c) => [
          c.campaign,
          c.count,
          money(c.amount),
        ]),
      });
    }
    sections.push({
      heading: `Expenses (${filtered.length})`,
      note: detailFilters
        ? `Filtered — ${detailFilters}.`
        : "Every expense in the range.",
      headers: [
        "Date",
        "Category",
        "Type",
        "Wallet",
        "Campaign",
        "Notes",
        "Source",
        "Amount",
      ],
      aligns: ["l", "l", "l", "l", "l", "l", "l", "r"],
      rows: filtered.map((e) => [
        formatDate(e.expenseDate),
        e.categoryName,
        COST_TYPE_LABELS[e.costType],
        e.walletName ?? "—",
        e.campaignName ?? "—",
        e.notes ?? "—",
        autoExpenseSource(e.refTable)?.label ?? "Manual",
        money(e.amount),
      ]),
    });

    return {
      title: "Expense Report (R8)",
      subtitle: rangeLabel,
      landscape: true,
      kpis: [
        {
          label: "Total expenses",
          value: `${money(report.total)} · ${report.count} entries`,
        },
        {
          label: "Fixed",
          value: `${money(report.fixedTotal)} · ${fixedPct}% of total`,
        },
        {
          label: "Variable",
          value: `${money(report.variableTotal)} · ${100 - fixedPct}% of total`,
        },
        {
          label: "Ad cost",
          value: `${money(report.adCost.total)} · peak ${money(report.adCost.peak)}/day`,
        },
      ],
      sections,
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Expense report</h1>
          <p className="text-sm text-muted-foreground">
            R8 — expenses by category, fixed vs variable split, and the ad-cost daily
            trend. Includes auto-expenses from the purchase and courier modules.
          </p>
        </div>
        <ExportPdfButton
          filename={`expense-report-${csvDateStamp()}.pdf`}
          build={pdfPayload}
        />
      </div>

      {/* Date range */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <DateFilter
            value={detectPreset(fromDate, toDate, "month")}
            from={fromDate}
            to={toDate}
            onApply={(_preset, f, t) => {
              setFromDate(f);
              setToDate(t);
              applyRange(f, t);
            }}
          />
          <span className="ml-auto self-center text-sm text-muted-foreground">
            Showing {rangeLabel}
          </span>
        </CardContent>
      </Card>

      {/* Headline KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total expenses" value={money(report.total)} sub={`${report.count} entries`} />
        <Kpi label="Fixed" value={money(report.fixedTotal)} sub={`${fixedPct}% of total`} />
        <Kpi label="Variable" value={money(report.variableTotal)} sub={`${100 - fixedPct}% of total`} />
        <Kpi label="Ad cost" value={money(report.adCost.total)} sub={`peak ${money(report.adCost.peak)}/day`} />
      </div>

      {/* Fixed vs variable split */}
      <Card>
        <CardHeader>
          <CardTitle>Fixed vs variable</CardTitle>
          <CardDescription>
            SPEC §9.2 split — variable costs scale with sales; fixed costs are
            recurring overhead.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {report.total > 0 ? (
            <>
              <div className="flex h-6 w-full overflow-hidden rounded-md border">
                <div
                  className="bg-primary/80"
                  style={{ width: `${fixedPct}%` }}
                  title={`Fixed ${money(report.fixedTotal)}`}
                />
                <div
                  className="bg-amber-400"
                  style={{ width: `${100 - fixedPct}%` }}
                  title={`Variable ${money(report.variableTotal)}`}
                />
              </div>
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-sm bg-primary/80" />
                  Fixed — {money(report.fixedTotal)} ({fixedPct}%)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-sm bg-amber-400" />
                  Variable — {money(report.variableTotal)} ({100 - fixedPct}%)
                </span>
              </div>
            </>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No expenses in this range.
            </p>
          )}
        </CardContent>
      </Card>

      {/* By category */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>By category</CardTitle>
            <CardDescription>Where the money went, largest first.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={exportByCategory}
            disabled={report.byCategory.length === 0}
          >
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="w-[30%]">Share</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.byCategory.map((c) => (
                  <TableRow key={c.categoryId}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant={c.costType === "FIXED" ? "secondary" : "outline"}
                      >
                        {COST_TYPE_LABELS[c.costType]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary/70"
                            style={{
                              width: `${maxCatAmount > 0 ? (c.amount / maxCatAmount) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
                          {c.share}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {c.count}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {money(c.amount)}
                    </TableCell>
                  </TableRow>
                ))}
                {report.byCategory.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                      No expenses in this range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Ad cost daily trend */}
      <Card>
        <CardHeader>
          <CardTitle>Ad cost — daily trend</CardTitle>
          <CardDescription>
            {money(report.adCost.total)} total ad spend over {rangeLabel}
            {report.adCost.dailyContinuous
              ? ""
              : " · long range: only days with spend are shown"}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AdCostTrendChart data={report.adCost.daily} peak={report.adCost.peak} />

          {report.adCost.byCampaign.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead className="text-right">Entries</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.adCost.byCampaign.map((c) => (
                    <TableRow key={c.campaign}>
                      <TableCell className="font-medium">{c.campaign}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {c.count}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {money(c.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail list */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Expenses ({filtered.length})</CardTitle>
            <CardDescription>
              Every expense in the range. Filter by category or source.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={fCategory} onValueChange={setFCategory}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                {report.byCategory.map((c) => (
                  <SelectItem key={c.categoryId} value={String(c.categoryId)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={fSource} onValueChange={setFSource}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All sources</SelectItem>
                <SelectItem value="MANUAL">Manual</SelectItem>
                <SelectItem value="AUTO">Auto</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={exportDetail}
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
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Wallet</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e: ExpenseRow) => {
                  const source = autoExpenseSource(e.refTable);
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(e.expenseDate)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{e.categoryName}</span>
                          <Badge
                            variant={e.costType === "FIXED" ? "secondary" : "outline"}
                            className="text-[10px]"
                          >
                            {COST_TYPE_LABELS[e.costType]}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.walletName ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[16rem]">
                        {e.campaignName && (
                          <div className="text-xs">
                            <span className="text-muted-foreground">Campaign:</span>{" "}
                            {e.campaignName}
                          </div>
                        )}
                        {e.notes ? (
                          <div className="truncate text-xs text-muted-foreground" title={e.notes}>
                            {e.notes}
                          </div>
                        ) : (
                          !e.campaignName && (
                            <span className="text-muted-foreground">—</span>
                          )
                        )}
                      </TableCell>
                      <TableCell>
                        {source ? (
                          <Badge variant="secondary">{source.label}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Manual</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {money(e.amount)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                      No expenses match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Self-contained SVG bar chart (no chart dependency). Theme-aware via
// currentColor — bars inherit text-primary, axis text inherits text-muted-foreground.
function AdCostTrendChart({ data, peak }: { data: AdCostDay[]; peak: number }) {
  if (data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        No ad-cost expenses in this range.
      </div>
    );
  }

  const W = 760;
  const H = 220;
  const padL = 12;
  const padR = 12;
  const padT = 18;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const yMax = Math.max(peak, 1);
  const slotW = plotW / data.length;
  const barW = Math.max(1, slotW * 0.62);
  // Thin out x labels so they never collide (aim for ≤ ~13 labels).
  const labelStep = Math.max(1, Math.ceil(data.length / 13));
  const baselineY = padT + plotH;

  const dayOfMonth = (ymd: string) => ymd.slice(8, 10);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-56 w-full min-w-[520px]"
        role="img"
        aria-label="Ad cost daily trend"
      >
        {/* Peak gridline */}
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
          {/* Baseline */}
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

        {/* Bars */}
        <g className="text-primary">
          {data.map((d, i) => {
            const h = (d.amount / yMax) * plotH;
            const x = padL + i * slotW + (slotW - barW) / 2;
            const y = baselineY - h;
            return (
              <rect
                key={d.date}
                x={x}
                y={h > 0 ? y : baselineY - 1}
                width={barW}
                height={h > 0 ? h : 1}
                rx={1.5}
                fill="currentColor"
                opacity={d.amount > 0 ? 0.85 : 0.25}
              >
                <title>{`${d.date}: ৳${d.amount.toLocaleString("en-IN")}`}</title>
              </rect>
            );
          })}
        </g>

        {/* X labels */}
        <g className="text-muted-foreground">
          {data.map((d, i) =>
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
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardHeader>
    </Card>
  );
}
