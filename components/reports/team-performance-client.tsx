"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
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
import { money } from "@/lib/format";
import { toCsv, downloadCsv } from "@/lib/csv";
import { ExportPdfButton } from "@/components/reports/export-pdf-button";
import type { ReportPdfPayload } from "@/lib/report-pdf";
import type {
  PerfTargetView,
  TeamPerformanceReport,
} from "@/lib/team-performance";

// Target % cell: prefers the amount target (the money goal), falls back to the
// order-count target; confidential targets show a lock for non-privileged viewers.
function targetLabel(t: PerfTargetView | null): string {
  if (!t) return "—";
  if (t.hidden) return "•••";
  const parts: string[] = [];
  if (t.amountPct != null) parts.push(`${t.amountPct}% of ${money(t.targetAmount ?? 0)}`);
  if (t.ordersPct != null) parts.push(`${t.ordersPct}% of ${t.targetOrders} orders`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function TeamPerformanceClient({
  report,
}: {
  report: TeamPerformanceReport;
}) {
  const router = useRouter();
  const [month, setMonth] = useState(report.monthKey);

  function apply() {
    router.push(`/reports/team?month=${month}`);
  }

  const seCsvHeaders = [
    "SE", "Team", "Leads", "Converted", "Conversion %",
    "Orders", "Sales value", "Avg order value", "Target",
  ];
  const seCsvRows = report.rows.map((r) => [
    r.name,
    r.teamName ?? "",
    r.leads,
    r.converted,
    r.conversionPct,
    r.orders,
    r.salesValue,
    r.avgOrderValue,
    targetLabel(r.target),
  ]);

  function pdfPayload(): ReportPdfPayload {
    const sections: ReportPdfPayload["sections"] = [
      {
        heading: "Per sales executive",
        headers: seCsvHeaders,
        aligns: ["l", "l", "r", "r", "r", "r", "r", "r", "l"],
        rows: report.rows.map((r) => [
          r.name + (r.isOnboarding ? " (onboarding)" : ""),
          r.teamName ?? "—",
          r.leads,
          r.converted,
          `${r.conversionPct}%`,
          r.orders,
          money(r.salesValue),
          money(r.avgOrderValue),
          targetLabel(r.target),
        ]),
      },
    ];
    if (report.teams.length > 0) {
      sections.push({
        heading: "Per team",
        note: "Onboarding members inside the grace window are excluded from team aggregates (§10).",
        headers: [
          "Team", "Members", "Leads", "Converted", "Conversion %",
          "Orders", "Sales value", "Avg order value", "Target",
        ],
        aligns: ["l", "r", "r", "r", "r", "r", "r", "r", "l"],
        rows: report.teams.map((t) => [
          t.name,
          t.excludedOnboarding > 0
            ? `${t.members} (−${t.excludedOnboarding})`
            : t.members,
          t.leads,
          t.converted,
          `${t.conversionPct}%`,
          t.orders,
          money(t.salesValue),
          money(t.avgOrderValue),
          targetLabel(t.target),
        ]),
      });
    }
    return {
      title: "Team Performance (R3)",
      subtitle: `Month: ${report.monthKey}`,
      landscape: true,
      sections,
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Team performance</h1>
          <p className="text-sm text-muted-foreground">
            R3 — per SE: leads, conversion, orders, sales value, avg order value
            and target progress for the month.
          </p>
        </div>
        <ExportPdfButton
          filename={`team-performance-${report.monthKey}.pdf`}
          build={pdfPayload}
        />
      </div>

      {/* Month picker */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="grid gap-1">
            <Label className="text-xs">Month</Label>
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-44"
            />
          </div>
          <Button onClick={apply}>Apply</Button>
          <span className="ml-auto self-center text-sm text-muted-foreground">
            Showing {report.monthKey}
            {report.scope === "own" && " · your performance"}
            {report.scope === "team" && " · your team"}
          </span>
        </CardContent>
      </Card>

      {/* Per SE */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Per sales executive</CardTitle>
            <CardDescription>
              Orders &amp; value exclude cancelled/returned/refunded (§4.2) —
              same rule as targets and the leaderboard.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={report.rows.length === 0}
            onClick={() =>
              downloadCsv(
                `team-performance-${report.monthKey}.csv`,
                toCsv(seCsvHeaders, seCsvRows)
              )
            }
          >
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SE</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Converted</TableHead>
                  <TableHead className="text-right">Conv. %</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Sales value</TableHead>
                  <TableHead className="text-right">AOV</TableHead>
                  <TableHead>Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((r) => (
                  <TableRow key={r.userId}>
                    <TableCell className="font-medium">
                      {r.name}
                      {r.isOnboarding && (
                        <Badge variant="outline" className="ml-2">onboarding</Badge>
                      )}
                    </TableCell>
                    <TableCell>{r.teamName ?? "—"}</TableCell>
                    <TableCell className="text-right">{r.leads}</TableCell>
                    <TableCell className="text-right">{r.converted}</TableCell>
                    <TableCell className="text-right">{r.conversionPct}%</TableCell>
                    <TableCell className="text-right">{r.orders}</TableCell>
                    <TableCell className="text-right font-medium">
                      {money(r.salesValue)}
                    </TableCell>
                    <TableCell className="text-right">{money(r.avgOrderValue)}</TableCell>
                    <TableCell>
                      <TargetCell target={r.target} />
                    </TableCell>
                  </TableRow>
                ))}
                {report.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">
                      No sales executives in scope.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Per team */}
      {report.teams.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Per team</CardTitle>
              <CardDescription>
                Onboarding members inside the grace window don&apos;t count
                toward team totals (§10).
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  `team-performance-teams-${report.monthKey}.csv`,
                  toCsv(
                    [
                      "Team", "Members", "Excluded (onboarding)", "Leads",
                      "Converted", "Conversion %", "Orders", "Sales value",
                      "Avg order value", "Target",
                    ],
                    report.teams.map((t) => [
                      t.name,
                      t.members,
                      t.excludedOnboarding,
                      t.leads,
                      t.converted,
                      t.conversionPct,
                      t.orders,
                      t.salesValue,
                      t.avgOrderValue,
                      targetLabel(t.target),
                    ])
                  )
                )
              }
            >
              Export CSV
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Team</TableHead>
                    <TableHead className="text-right">Members</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Converted</TableHead>
                    <TableHead className="text-right">Conv. %</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Sales value</TableHead>
                    <TableHead className="text-right">AOV</TableHead>
                    <TableHead>Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.teams.map((t) => (
                    <TableRow key={t.teamId}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell className="text-right">
                        {t.members}
                        {t.excludedOnboarding > 0 && (
                          <span
                            className="ml-1 text-xs text-muted-foreground"
                            title="onboarding members excluded from totals"
                          >
                            (−{t.excludedOnboarding})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{t.leads}</TableCell>
                      <TableCell className="text-right">{t.converted}</TableCell>
                      <TableCell className="text-right">{t.conversionPct}%</TableCell>
                      <TableCell className="text-right">{t.orders}</TableCell>
                      <TableCell className="text-right font-medium">
                        {money(t.salesValue)}
                      </TableCell>
                      <TableCell className="text-right">{money(t.avgOrderValue)}</TableCell>
                      <TableCell>
                        <TargetCell target={t.target} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TargetCell({ target }: { target: PerfTargetView | null }) {
  if (!target) return <span className="text-muted-foreground">—</span>;
  if (target.hidden) {
    return (
      <span className="text-muted-foreground" title="Confidential target">
        •••
      </span>
    );
  }
  const pct = target.amountPct ?? target.ordersPct;
  if (pct == null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex min-w-[140px] items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${pct >= 100 ? "bg-green-500" : "bg-primary/70"}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="shrink-0 text-xs font-medium">{pct}%</span>
    </div>
  );
}
