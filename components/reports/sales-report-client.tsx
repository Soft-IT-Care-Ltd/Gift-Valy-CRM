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
import { formatDate, money } from "@/lib/format";
import { toCsv, downloadCsv, csvDateStamp } from "@/lib/csv";
import { ExportPdfButton } from "@/components/reports/export-pdf-button";
import { ORDER_STATUS_LABELS } from "@/lib/order-constants";
import type { ReportPdfPayload } from "@/lib/report-pdf";
import type { SalesGroupRow, SalesReport } from "@/lib/order-reports";

export function SalesReportClient({
  report,
  seOptions,
  teamOptions,
  filters,
}: {
  report: SalesReport;
  seOptions: { id: number; name: string }[];
  teamOptions: { id: number; name: string }[];
  filters: { from: string; to: string; seId: string; teamId: string };
}) {
  const router = useRouter();
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [seId, setSeId] = useState(filters.seId);
  const [teamId, setTeamId] = useState(filters.teamId);

  function apply() {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (seId !== "ALL") p.set("seId", seId);
    if (teamId !== "ALL") p.set("teamId", teamId);
    router.push(`/reports/sales${p.toString() ? `?${p}` : ""}`);
  }
  function reset() {
    setFrom("");
    setTo("");
    setSeId("ALL");
    setTeamId("ALL");
    router.push("/reports/sales");
  }

  const rangeLabel = `${formatDate(report.range.from)} → ${formatDate(report.range.to)}`;

  const GROUP_HEADERS = ["", "Orders", "Sales value", "Delivered", "Cancelled"];
  function groupCsv(name: string, labelHead: string, rows: SalesGroupRow[]) {
    downloadCsv(
      `sales-by-${name}-${csvDateStamp()}.csv`,
      toCsv(
        [labelHead, ...GROUP_HEADERS.slice(1)],
        rows.map((r) => [r.label, r.orders, r.salesValue, r.delivered, r.cancelled])
      )
    );
  }

  function pdfPayload(): ReportPdfPayload {
    const groupSection = (heading: string, labelHead: string, rows: SalesGroupRow[]) => ({
      heading,
      headers: [labelHead, "Orders", "Sales value", "Delivered", "Cancelled"],
      aligns: ["l", "r", "r", "r", "r"] as ("l" | "r")[],
      rows: rows.map((r) => [
        r.label,
        r.orders,
        money(r.salesValue),
        r.delivered,
        r.cancelled,
      ]),
    });
    return {
      title: "Sales Report (R1)",
      subtitle: `${rangeLabel}${seId !== "ALL" ? ` · SE: ${seOptions.find((s) => String(s.id) === seId)?.name ?? seId}` : ""}${teamId !== "ALL" ? ` · Team: ${teamOptions.find((t) => String(t.id) === teamId)?.name ?? teamId}` : ""}`,
      kpis: [
        { label: "Orders", value: String(report.totalOrders) },
        { label: "Sales value", value: money(report.salesValue) },
        { label: "Avg order value", value: money(report.avgOrderValue) },
        {
          label: "Delivered",
          value: `${report.delivered.count} · ${money(report.delivered.value)}`,
        },
        {
          label: "Cancelled/Returned",
          value: `${report.cancelled.count} · ${money(report.cancelled.value)}`,
        },
      ],
      sections: [
        {
          heading: "By status",
          headers: ["Status", "Orders", "Value"],
          aligns: ["l", "r", "r"],
          rows: report.byStatus.map((r) => [
            ORDER_STATUS_LABELS[r.status] ?? r.status,
            r.orders,
            money(r.value),
          ]),
        },
        groupSection("By day", "Date", report.byDay),
        groupSection("By sales executive", "SE", report.bySE),
        groupSection("By team", "Team", report.byTeam),
        groupSection("By country", "Country", report.byCountry),
        {
          heading: "By package",
          note: "Over sale orders only — cancelled/returned orders don't count as sold.",
          headers: ["Package", "Qty", "Orders", "Value"],
          aligns: ["l", "r", "r", "r"],
          rows: report.byPackage.map((r) => [
            r.label,
            r.qty,
            r.orders,
            money(r.value),
          ]),
        },
      ],
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Sales report</h1>
          <p className="text-sm text-muted-foreground">
            R1 — orders &amp; value by day, SE, team, package and country, with
            delivered vs cancelled.
          </p>
        </div>
        <ExportPdfButton
          filename={`sales-report-${csvDateStamp()}.pdf`}
          build={pdfPayload}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="grid gap-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          {seOptions.length > 0 && (
            <div className="grid gap-1">
              <Label className="text-xs">SE</Label>
              <Select value={seId} onValueChange={setSeId}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Everyone</SelectItem>
                  {seOptions.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {teamOptions.length > 0 && (
            <div className="grid gap-1">
              <Label className="text-xs">Team</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All teams</SelectItem>
                  {teamOptions.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button onClick={apply}>Apply</Button>
          <Button variant="outline" onClick={reset}>This month</Button>
          <span className="ml-auto self-center text-sm text-muted-foreground">
            Showing {rangeLabel}
          </span>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi
          label="Orders"
          value={String(report.totalOrders)}
          sub={`${report.salesOrders} counting as sales`}
        />
        <Kpi
          label="Sales value"
          value={money(report.salesValue)}
          sub="excludes cancelled / returned / refunded"
        />
        <Kpi label="Avg order value" value={money(report.avgOrderValue)} />
        <Kpi
          label="Delivered"
          value={String(report.delivered.count)}
          sub={money(report.delivered.value)}
        />
        <Kpi
          label="Cancelled / returned"
          value={String(report.cancelled.count)}
          sub={money(report.cancelled.value)}
        />
      </div>

      {/* By status */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>By status</CardTitle>
            <CardDescription>Every order in the range, by current status.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={report.byStatus.length === 0}
            onClick={() =>
              downloadCsv(
                `sales-by-status-${csvDateStamp()}.csv`,
                toCsv(
                  ["Status", "Orders", "Value"],
                  report.byStatus.map((r) => [
                    ORDER_STATUS_LABELS[r.status] ?? r.status,
                    r.orders,
                    r.value,
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
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.byStatus.map((r) => (
                  <TableRow key={r.status}>
                    <TableCell className="font-medium">
                      {ORDER_STATUS_LABELS[r.status] ?? r.status}
                    </TableCell>
                    <TableCell className="text-right">{r.orders}</TableCell>
                    <TableCell className="text-right">{money(r.value)}</TableCell>
                  </TableRow>
                ))}
                {report.byStatus.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                      No orders in this range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <GroupTable
        title="By day"
        labelHead="Date"
        rows={report.byDay}
        onExport={() => groupCsv("day", "Date", report.byDay)}
      />
      <GroupTable
        title="By sales executive"
        labelHead="SE"
        rows={report.bySE}
        onExport={() => groupCsv("se", "SE", report.bySE)}
      />
      <GroupTable
        title="By team"
        labelHead="Team"
        rows={report.byTeam}
        onExport={() => groupCsv("team", "Team", report.byTeam)}
      />
      <GroupTable
        title="By country"
        labelHead="Country"
        rows={report.byCountry}
        onExport={() => groupCsv("country", "Country", report.byCountry)}
      />

      {/* By package */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>By package</CardTitle>
            <CardDescription>
              Packages sold in the range — sale orders only.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={report.byPackage.length === 0}
            onClick={() =>
              downloadCsv(
                `sales-by-package-${csvDateStamp()}.csv`,
                toCsv(
                  ["Package", "Qty", "Orders", "Value"],
                  report.byPackage.map((r) => [r.label, r.qty, r.orders, r.value])
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
                  <TableHead>Package</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.byPackage.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-right">{r.qty}</TableCell>
                    <TableCell className="text-right">{r.orders}</TableCell>
                    <TableCell className="text-right">{money(r.value)}</TableCell>
                  </TableRow>
                ))}
                {report.byPackage.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      No packages sold in this range.
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

function GroupTable({
  title,
  labelHead,
  rows,
  onExport,
}: {
  title: string;
  labelHead: string;
  rows: SalesGroupRow[];
  onExport: () => void;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.salesValue), 0);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        <Button variant="outline" size="sm" onClick={onExport} disabled={rows.length === 0}>
          Export CSV
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{labelHead}</TableHead>
                <TableHead className="w-[24%]">Volume</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Sales value</TableHead>
                <TableHead className="text-right">Delivered</TableHead>
                <TableHead className="text-right">Cancelled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary/70"
                        style={{ width: `${max > 0 ? (r.salesValue / max) * 100 : 0}%` }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{r.orders}</TableCell>
                  <TableCell className="text-right font-medium">
                    {money(r.salesValue)}
                  </TableCell>
                  <TableCell className="text-right">{r.delivered}</TableCell>
                  <TableCell className="text-right">{r.cancelled}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    No orders in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
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
