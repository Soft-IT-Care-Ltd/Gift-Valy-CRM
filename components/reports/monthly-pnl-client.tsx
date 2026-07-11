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
import { money } from "@/lib/format";
import { toCsv, downloadCsv, csvDateStamp } from "@/lib/csv";
import { ExportPdfButton } from "@/components/reports/export-pdf-button";
import { PnlNav } from "@/components/reports/pnl-nav";
import {
  REVENUE_BASES,
  REVENUE_BASIS_LABELS,
  type RevenueBasis,
} from "@/lib/pnl-constants";
import type { ReportPdfPayload } from "@/lib/report-pdf";
import type { MonthlyPnl } from "@/lib/pnl";

const pctText = (n: number) => `${n.toFixed(1)}%`;

// Signed money for deltas — uses a real minus glyph to match the money() output.
function delta(n: number): { text: string; tone: "pos" | "neg" | "flat" } {
  if (n === 0) return { text: "—", tone: "flat" };
  const tone = n > 0 ? "pos" : "neg";
  return { text: `${n > 0 ? "+" : "−"}${money(Math.abs(n))}`, tone };
}

export function MonthlyPnlClient({ pnl }: { pnl: MonthlyPnl }) {
  const router = useRouter();
  const { current, previous, deltas } = pnl;
  const [ym, setYm] = useState(current.ym);
  const [basis, setBasis] = useState<RevenueBasis>(current.basis);

  function apply(nextYm: string, nextBasis: RevenueBasis) {
    const params = new URLSearchParams();
    params.set("ym", nextYm);
    params.set("basis", nextBasis);
    router.push(`/reports/pnl/monthly?${params}`);
  }

  function exportCsv() {
    const headers = ["Line", current.label, previous.label, "Change"];
    const rows: (string | number)[][] = [
      ["Revenue", current.revenue, previous.revenue, deltas.revenue],
      ["COGS", current.cogs, previous.cogs, deltas.cogs],
      ["Gross profit", current.grossProfit, previous.grossProfit, deltas.grossProfit],
      ["Gross margin %", current.grossMarginPct, previous.grossMarginPct, ""],
      ["Variable costs", current.variableCost, previous.variableCost, deltas.variableCost],
      ...current.variableLines.map((l) => [
        `  ${l.name}`,
        l.amount,
        previous.variableLines.find((p) => p.name === l.name)?.amount ?? 0,
        "",
      ]),
      ["Fixed costs", current.fixedCost, previous.fixedCost, deltas.fixedCost],
      ...current.fixedLines.map((l) => [
        `  ${l.name}`,
        l.amount,
        previous.fixedLines.find((p) => p.name === l.name)?.amount ?? 0,
        "",
      ]),
      ["Net profit", current.netProfit, previous.netProfit, deltas.netProfit],
      ["Net margin %", current.netMarginPct, previous.netMarginPct, ""],
      ["Orders", current.orderCount, previous.orderCount, ""],
      ["Per-order avg profit", current.perOrderAvgProfit, previous.perOrderAvgProfit, ""],
    ];
    downloadCsv(
      `monthly-pnl-${current.ym}-${csvDateStamp()}.csv`,
      toCsv(headers, rows)
    );
  }

  function pdfPayload(): ReportPdfPayload {
    const statementRows: (string | number | null)[][] = [
      [
        "Revenue",
        money(current.revenue),
        money(previous.revenue),
        delta(deltas.revenue).text,
      ],
      [
        "− Cost of goods sold",
        `(${money(current.cogs)})`,
        `(${money(previous.cogs)})`,
        delta(deltas.cogs).text,
      ],
      [
        `= Gross profit (${pctText(current.grossMarginPct)} margin)`,
        money(current.grossProfit),
        money(previous.grossProfit),
        delta(deltas.grossProfit).text,
      ],
      ["− Variable costs", money(current.variableCost), "", ""],
      ...(current.variableLines.length > 0
        ? current.variableLines.map((l) => [
            `  ${l.name}`,
            money(l.amount),
            money(previous.variableLines.find((p) => p.name === l.name)?.amount ?? 0),
            "",
          ])
        : [["  No variable costs recorded", "", "", ""]]),
      ["− Fixed costs", money(current.fixedCost), "", ""],
      ...(current.fixedLines.length > 0
        ? current.fixedLines.map((l) => [
            `  ${l.name}`,
            money(l.amount),
            money(previous.fixedLines.find((p) => p.name === l.name)?.amount ?? 0),
            "",
          ])
        : [["  No fixed costs recorded", "", "", ""]]),
      [
        `= Net profit (${pctText(current.netMarginPct)} margin)`,
        money(current.netProfit),
        money(previous.netProfit),
        delta(deltas.netProfit).text,
      ],
    ];
    const caveats = [
      current.inventoryPurchased > 0
        ? `Inventory purchased this month: ${money(current.inventoryPurchased)} — excluded from operating costs (expensed as COGS when the goods sell).`
        : null,
      current.cogsIncompleteCount > 0
        ? `${current.cogsIncompleteCount} order(s) counted in revenue aren't packed yet, so their product cost isn't frozen — COGS (and net profit) will firm up once they're packed.`
        : null,
    ].filter((c): c is string => c !== null);
    return {
      title: "Monthly P&L (R9)",
      subtitle: `${current.label} vs ${previous.label} · ${REVENUE_BASIS_LABELS[current.basis]}`,
      kpis: [
        {
          label: "Revenue",
          value: `${money(current.revenue)} · ${current.orderCount} orders`,
        },
        {
          label: "Gross profit",
          value: `${money(current.grossProfit)} · ${pctText(current.grossMarginPct)} margin`,
        },
        {
          label: "Net profit",
          value: `${money(current.netProfit)} · ${pctText(current.netMarginPct)} margin`,
        },
        { label: "Per-order avg profit", value: money(current.perOrderAvgProfit) },
      ],
      sections: [
        {
          heading: `Profit & loss — ${current.label}`,
          note: [
            `${REVENUE_BASIS_LABELS[current.basis]}. COGS is the frozen cost of goods sold; inventory purchases are excluded from operating costs (they hit COGS when the goods sell).`,
            ...caveats,
          ].join(" "),
          headers: ["Line", current.label, previous.label, "Change"],
          aligns: ["l", "r", "r", "r"],
          rows: statementRows,
        },
        {
          heading: `vs ${previous.label}`,
          note: "Month-over-month change on the key lines.",
          headers: ["Line", "Change"],
          aligns: ["l", "r"],
          rows: [
            ["Revenue", delta(deltas.revenue).text],
            ["Gross profit", delta(deltas.grossProfit).text],
            ["Net profit", delta(deltas.netProfit).text],
            ["Variable costs", delta(deltas.variableCost).text],
            ["Fixed costs", delta(deltas.fixedCost).text],
            ["COGS", delta(deltas.cogs).text],
          ],
        },
      ],
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Monthly P&amp;L</h1>
          <p className="text-sm text-muted-foreground">
            R9 (SPEC §9.2) — revenue − COGS − variable − fixed = net profit, with
            margins and a comparison against the previous month.
          </p>
        </div>
        <ExportPdfButton
          filename={`monthly-pnl-${current.ym}-${csvDateStamp()}.pdf`}
          build={pdfPayload}
        />
      </div>

      <PnlNav />

      {/* Controls */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="grid gap-1">
            <Label className="text-xs">Month</Label>
            <Input
              type="month"
              value={ym}
              onChange={(e) => {
                setYm(e.target.value);
                if (e.target.value) apply(e.target.value, basis);
              }}
              className="w-44"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Revenue basis</Label>
            <Select
              value={basis}
              onValueChange={(v) => {
                setBasis(v as RevenueBasis);
                apply(ym, v as RevenueBasis);
              }}
            >
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REVENUE_BASES.map((b) => (
                  <SelectItem key={b} value={b}>
                    {REVENUE_BASIS_LABELS[b]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" className="ml-auto" onClick={exportCsv}>
            Export CSV
          </Button>
        </CardContent>
      </Card>

      {/* Headline KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Revenue"
          value={money(current.revenue)}
          sub={`${current.orderCount} orders · ${current.label}`}
        />
        <Kpi
          label="Gross profit"
          value={money(current.grossProfit)}
          sub={`${pctText(current.grossMarginPct)} margin`}
        />
        <Kpi
          label="Net profit"
          value={money(current.netProfit)}
          sub={`${pctText(current.netMarginPct)} margin`}
          tone={current.netProfit >= 0 ? "pos" : "neg"}
        />
        <Kpi
          label="Per-order avg profit"
          value={money(current.perOrderAvgProfit)}
          sub="net ÷ orders"
        />
      </div>

      {/* P&L statement */}
      <Card>
        <CardHeader>
          <CardTitle>Profit &amp; loss — {current.label}</CardTitle>
          <CardDescription>
            {REVENUE_BASIS_LABELS[current.basis]}. COGS is the frozen cost of goods
            sold; inventory purchases are excluded from operating costs (they hit
            COGS when the goods sell).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">Line</TableHead>
                  <TableHead className="text-right">{current.label}</TableHead>
                  <TableHead className="text-right text-muted-foreground">
                    {previous.label}
                  </TableHead>
                  <TableHead className="text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <StatementRow
                  label="Revenue"
                  cur={current.revenue}
                  prev={previous.revenue}
                  d={deltas.revenue}
                  strong
                />
                <StatementRow
                  label="− Cost of goods sold"
                  cur={current.cogs}
                  prev={previous.cogs}
                  d={deltas.cogs}
                  negative
                />
                <StatementRow
                  label="= Gross profit"
                  cur={current.grossProfit}
                  prev={previous.grossProfit}
                  d={deltas.grossProfit}
                  strong
                  extra={`${pctText(current.grossMarginPct)} margin`}
                />

                <SectionRow label="Variable costs" amount={current.variableCost} />
                {current.variableLines.map((l) => (
                  <SubRow
                    key={`v-${l.name}`}
                    label={l.name}
                    cur={l.amount}
                    prev={previous.variableLines.find((p) => p.name === l.name)?.amount ?? 0}
                  />
                ))}
                {current.variableLines.length === 0 && (
                  <EmptySubRow label="No variable costs recorded" />
                )}

                <SectionRow label="Fixed costs" amount={current.fixedCost} />
                {current.fixedLines.map((l) => (
                  <SubRow
                    key={`f-${l.name}`}
                    label={l.name}
                    cur={l.amount}
                    prev={previous.fixedLines.find((p) => p.name === l.name)?.amount ?? 0}
                  />
                ))}
                {current.fixedLines.length === 0 && (
                  <EmptySubRow label="No fixed costs recorded" />
                )}

                <StatementRow
                  label="= Net profit"
                  cur={current.netProfit}
                  prev={previous.netProfit}
                  d={deltas.netProfit}
                  strong
                  extra={`${pctText(current.netMarginPct)} margin`}
                  highlight
                />
              </TableBody>
            </Table>
          </div>

          {/* Caveats */}
          <div className="mt-4 space-y-1 text-xs text-muted-foreground">
            {current.inventoryPurchased > 0 && (
              <p>
                Inventory purchased this month: {money(current.inventoryPurchased)} —
                excluded from operating costs (expensed as COGS when the goods sell).
              </p>
            )}
            {current.cogsIncompleteCount > 0 && (
              <p className="text-amber-600 dark:text-amber-400">
                {current.cogsIncompleteCount} order(s) counted in revenue aren&apos;t
                packed yet, so their product cost isn&apos;t frozen — COGS (and net
                profit) will firm up once they&apos;re packed.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Comparison summary */}
      <Card>
        <CardHeader>
          <CardTitle>vs {previous.label}</CardTitle>
          <CardDescription>Month-over-month change on the key lines.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DeltaTile label="Revenue" d={deltas.revenue} />
          <DeltaTile label="Gross profit" d={deltas.grossProfit} />
          <DeltaTile label="Net profit" d={deltas.netProfit} />
          <DeltaTile label="Variable costs" d={deltas.variableCost} invert />
          <DeltaTile label="Fixed costs" d={deltas.fixedCost} invert />
          <DeltaTile label="COGS" d={deltas.cogs} invert />
        </CardContent>
      </Card>
    </div>
  );
}

function StatementRow({
  label,
  cur,
  prev,
  d,
  strong,
  negative,
  extra,
  highlight,
}: {
  label: string;
  cur: number;
  prev: number;
  d: number;
  strong?: boolean;
  negative?: boolean;
  extra?: string;
  highlight?: boolean;
}) {
  const dd = delta(d);
  return (
    <TableRow className={highlight ? "bg-muted/40" : undefined}>
      <TableCell className={strong ? "font-semibold" : ""}>
        {label}
        {extra && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {extra}
          </span>
        )}
      </TableCell>
      <TableCell className={`text-right ${strong ? "font-semibold" : ""}`}>
        {negative ? `(${money(cur)})` : money(cur)}
      </TableCell>
      <TableCell className="text-right text-muted-foreground">
        {negative ? `(${money(prev)})` : money(prev)}
      </TableCell>
      <TableCell
        className={`text-right text-sm ${
          dd.tone === "pos"
            ? "text-emerald-600 dark:text-emerald-400"
            : dd.tone === "neg"
              ? "text-red-600 dark:text-red-400"
              : "text-muted-foreground"
        }`}
      >
        {dd.text}
      </TableCell>
    </TableRow>
  );
}

function SectionRow({ label, amount }: { label: string; amount: number }) {
  return (
    <TableRow>
      <TableCell className="font-medium">− {label}</TableCell>
      <TableCell className="text-right font-medium">{money(amount)}</TableCell>
      <TableCell className="text-right" />
      <TableCell className="text-right" />
    </TableRow>
  );
}

function SubRow({ label, cur, prev }: { label: string; cur: number; prev: number }) {
  return (
    <TableRow>
      <TableCell className="pl-8 text-sm text-muted-foreground">{label}</TableCell>
      <TableCell className="text-right text-sm">{money(cur)}</TableCell>
      <TableCell className="text-right text-sm text-muted-foreground">
        {money(prev)}
      </TableCell>
      <TableCell className="text-right" />
    </TableRow>
  );
}

function EmptySubRow({ label }: { label: string }) {
  return (
    <TableRow>
      <TableCell className="pl-8 text-sm text-muted-foreground" colSpan={4}>
        {label}
      </TableCell>
    </TableRow>
  );
}

function DeltaTile({
  label,
  d,
  invert,
}: {
  label: string;
  d: number;
  invert?: boolean;
}) {
  // For cost lines, a decrease is "good" — invert the tone colour.
  const good = invert ? d < 0 : d > 0;
  const bad = invert ? d > 0 : d < 0;
  const dd = delta(d);
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-semibold ${
          d === 0
            ? ""
            : good
              ? "text-emerald-600 dark:text-emerald-400"
              : bad
                ? "text-red-600 dark:text-red-400"
                : ""
        }`}
      >
        {dd.text}
      </div>
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
