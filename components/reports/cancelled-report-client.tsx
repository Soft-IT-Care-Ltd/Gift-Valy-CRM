"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import type { CancelledReport } from "@/lib/order-reports";

const STATUS_BADGE: Record<string, "destructive" | "secondary" | "outline"> = {
  CANCELLED: "destructive",
  RETURNED: "secondary",
  REFUNDED: "outline",
};

export function CancelledReportClient({
  report,
  seOptions,
  filters,
}: {
  report: CancelledReport;
  seOptions: { id: number; name: string }[];
  filters: { from: string; to: string; seId: string };
}) {
  const router = useRouter();
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [seId, setSeId] = useState(filters.seId);

  function apply() {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (seId !== "ALL") p.set("seId", seId);
    router.push(`/reports/cancelled${p.toString() ? `?${p}` : ""}`);
  }
  function reset() {
    setFrom("");
    setTo("");
    setSeId("ALL");
    router.push("/reports/cancelled");
  }

  const rangeLabel = `${formatDate(report.range.from)} → ${formatDate(report.range.to)}`;

  function pdfPayload(): ReportPdfPayload {
    return {
      title: "Cancelled / Returned Analysis (R11)",
      subtitle: `${rangeLabel}${seId !== "ALL" ? ` · SE: ${seOptions.find((s) => String(s.id) === seId)?.name ?? seId}` : ""}`,
      kpis: [
        { label: "Value lost", value: money(report.lostValue) },
        { label: "Loss rate", value: `${report.lossRatePct}% of ${report.totalOrders} orders` },
        {
          label: "Cancelled",
          value: `${report.cancelled.count} · ${money(report.cancelled.value)}`,
        },
        {
          label: "Returned",
          value: `${report.returned.count} · ${money(report.returned.value)}`,
        },
        {
          label: "Refunded",
          value: `${report.refunded.count} · ${money(report.refunded.value)}`,
        },
      ],
      sections: [
        {
          heading: "By reason",
          headers: ["Reason", "Orders", "Value", "Share"],
          aligns: ["l", "r", "r", "r"],
          rows: report.byReason.map((r) => [
            r.reason,
            r.count,
            money(r.value),
            `${r.share}%`,
          ]),
        },
        {
          heading: "By sales executive",
          note: "Loss rate = lost orders ÷ everything the SE booked in the range.",
          headers: [
            "SE",
            "Booked",
            "Cancelled",
            "Cancelled ৳",
            "Returned",
            "Returned ৳",
            "Refunded",
            "Refunded ৳",
            "Loss rate",
          ],
          aligns: ["l", "r", "r", "r", "r", "r", "r", "r", "r"],
          rows: report.bySE.map((r) => [
            r.label,
            r.totalOrders,
            r.cancelled,
            money(r.cancelledValue),
            r.returned,
            money(r.returnedValue),
            r.refunded,
            money(r.refundedValue),
            `${r.lossRatePct}%`,
          ]),
        },
        {
          heading: "Lost orders",
          headers: ["Order", "Date", "Status", "Reason", "Customer", "SE", "Value"],
          aligns: ["l", "l", "l", "l", "l", "l", "r"],
          rows: report.rows.map((r) => [
            r.orderNo,
            formatDate(r.createdAt),
            ORDER_STATUS_LABELS[r.status] ?? r.status,
            r.reason,
            r.customerName,
            r.salesExecutive,
            money(r.value),
          ]),
        },
      ],
      landscape: true,
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Cancelled / returned analysis</h1>
          <p className="text-sm text-muted-foreground">
            R11 — why orders were lost, the value lost, and how it distributes
            across sales executives.
          </p>
        </div>
        <ExportPdfButton
          filename={`cancelled-returned-${csvDateStamp()}.pdf`}
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
          <Button onClick={apply}>Apply</Button>
          <Button variant="outline" onClick={reset}>This month</Button>
          <span className="ml-auto self-center text-sm text-muted-foreground">
            Showing {rangeLabel}
          </span>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Value lost" value={money(report.lostValue)} sub={`${report.lostCount} orders`} />
        <Kpi
          label="Loss rate"
          value={`${report.lossRatePct}%`}
          sub={`of ${report.totalOrders} orders booked`}
        />
        <Kpi
          label="Cancelled"
          value={String(report.cancelled.count)}
          sub={money(report.cancelled.value)}
        />
        <Kpi
          label="Returned"
          value={String(report.returned.count)}
          sub={money(report.returned.value)}
        />
        <Kpi
          label="Refunded"
          value={String(report.refunded.count)}
          sub={money(report.refunded.value)}
        />
      </div>

      {/* By reason */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>By reason</CardTitle>
            <CardDescription>
              Cancel reasons as recorded on the order; courier returns without a
              recorded reason are grouped separately.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={report.byReason.length === 0}
            onClick={() =>
              downloadCsv(
                `lost-by-reason-${csvDateStamp()}.csv`,
                toCsv(
                  ["Reason", "Orders", "Value", "Share %"],
                  report.byReason.map((r) => [r.reason, r.count, r.value, r.share])
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
                  <TableHead>Reason</TableHead>
                  <TableHead className="w-[32%]">Share</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.byReason.map((r) => (
                  <TableRow key={r.reason}>
                    <TableCell className="font-medium">{r.reason}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-destructive/70"
                            style={{ width: `${r.share}%` }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
                          {r.share}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{r.count}</TableCell>
                    <TableCell className="text-right">{money(r.value)}</TableCell>
                  </TableRow>
                ))}
                {report.byReason.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      No cancelled or returned orders in this range. 🎉
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* SE-wise */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>By sales executive</CardTitle>
            <CardDescription>
              Loss rate = lost orders ÷ everything the SE booked in the range.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={report.bySE.length === 0}
            onClick={() =>
              downloadCsv(
                `lost-by-se-${csvDateStamp()}.csv`,
                toCsv(
                  [
                    "SE", "Booked", "Cancelled", "Cancelled value", "Returned",
                    "Returned value", "Refunded", "Refunded value", "Loss rate %",
                  ],
                  report.bySE.map((r) => [
                    r.label, r.totalOrders, r.cancelled, r.cancelledValue,
                    r.returned, r.returnedValue, r.refunded, r.refundedValue,
                    r.lossRatePct,
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
                  <TableHead>SE</TableHead>
                  <TableHead className="text-right">Booked</TableHead>
                  <TableHead className="text-right">Cancelled</TableHead>
                  <TableHead className="text-right">Returned</TableHead>
                  <TableHead className="text-right">Refunded</TableHead>
                  <TableHead className="text-right">Value lost</TableHead>
                  <TableHead className="text-right">Loss rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.bySE.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-right">{r.totalOrders}</TableCell>
                    <TableCell className="text-right">
                      {r.cancelled}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {money(r.cancelledValue)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.returned}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {money(r.returnedValue)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.refunded}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {money(r.refundedValue)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {money(r.cancelledValue + r.returnedValue + r.refundedValue)}
                    </TableCell>
                    <TableCell className="text-right">{r.lossRatePct}%</TableCell>
                  </TableRow>
                ))}
                {report.bySE.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                      No lost orders in this range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Detail rows */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Lost orders</CardTitle>
            <CardDescription>{report.rows.length} orders, newest first.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={report.rows.length === 0}
            onClick={() =>
              downloadCsv(
                `lost-orders-${csvDateStamp()}.csv`,
                toCsv(
                  ["Order", "Date", "Status", "Reason", "Customer", "SE", "Value"],
                  report.rows.map((r) => [
                    r.orderNo,
                    formatDate(r.createdAt),
                    r.status,
                    r.reason,
                    r.customerName,
                    r.salesExecutive,
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
                  <TableHead>Order</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>SE</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((r) => (
                  <TableRow key={r.orderId}>
                    <TableCell>
                      <Link
                        href={`/orders/${r.orderId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.orderNo}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDate(r.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[r.status] ?? "outline"}>
                        {ORDER_STATUS_LABELS[r.status] ?? r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate" title={r.reason}>
                      {r.reason}
                    </TableCell>
                    <TableCell>{r.customerName}</TableCell>
                    <TableCell>{r.salesExecutive}</TableCell>
                    <TableCell className="text-right">{money(r.value)}</TableCell>
                  </TableRow>
                ))}
                {report.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                      No lost orders in this range.
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
