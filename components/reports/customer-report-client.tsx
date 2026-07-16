"use client";

import { useState } from "react";
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
import { formatDate, money } from "@/lib/format";
import { toCsv, downloadCsv, csvDateStamp } from "@/lib/csv";
import { ExportPdfButton } from "@/components/reports/export-pdf-button";
import type { ReportPdfPayload } from "@/lib/report-pdf";
import type { CustomerReport, CustomerRow } from "@/lib/order-reports";

const CUSTOMER_HEADERS = [
  "Customer",
  "Phone (foreign)",
  "Country",
  "Orders",
  "Sale orders",
  "Sales value",
  "First order",
  "Last order",
];

function customerCsvRows(rows: CustomerRow[]) {
  return rows.map((r) => [
    r.name,
    r.phoneForeign,
    r.country,
    r.orders,
    r.saleOrders,
    r.salesValue,
    formatDate(r.firstOrderAt),
    formatDate(r.lastOrderAt),
  ]);
}

export function CustomerReportClient({
  report,
  filters,
}: {
  report: CustomerReport;
  filters: { from: string; to: string };
}) {
  const router = useRouter();
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);

  function apply(f: string, t: string) {
    const p = new URLSearchParams();
    if (f) p.set("from", f);
    if (t) p.set("to", t);
    router.push(`/reports/customers${p.toString() ? `?${p}` : ""}`);
  }

  const rangeLabel =
    report.range.from || report.range.to
      ? `${report.range.from ? formatDate(report.range.from) : "…"} → ${report.range.to ? formatDate(report.range.to) : "…"}`
      : "All time";

  function pdfPayload(): ReportPdfPayload {
    const customerSection = (heading: string, note: string, rows: CustomerRow[]) => ({
      heading,
      note,
      headers: CUSTOMER_HEADERS,
      aligns: ["l", "l", "l", "r", "r", "r", "l", "l"] as ("l" | "r")[],
      rows: rows.map((r) => [
        r.name,
        r.phoneForeign,
        r.country,
        r.orders,
        r.saleOrders,
        money(r.salesValue),
        formatDate(r.firstOrderAt),
        formatDate(r.lastOrderAt),
      ]),
    });
    return {
      title: "Customer Report (R12)",
      subtitle: rangeLabel,
      landscape: true,
      kpis: [
        { label: "Customers", value: String(report.totalCustomers) },
        {
          label: "Repeat customers",
          value: `${report.repeatCustomers} (${report.repeatRatePct}%)`,
        },
        { label: "Sales value", value: money(report.totalSalesValue) },
        { label: "Avg / customer", value: money(report.avgValuePerCustomer) },
      ],
      sections: [
        {
          heading: "Per-country sales",
          headers: ["Country", "Customers", "Sale orders", "Sales value"],
          aligns: ["l", "r", "r", "r"],
          rows: report.byCountry.map((r) => [
            r.country,
            r.customers,
            r.saleOrders,
            money(r.salesValue),
          ]),
        },
        customerSection(
          "Top customers",
          `Top ${report.topCustomers.length} by sales value (cancelled/returned orders excluded from value).`,
          report.topCustomers
        ),
        customerSection(
          "Repeat customers",
          "Customers with 2+ sale orders, most orders first.",
          report.repeatRows
        ),
      ],
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Customer report</h1>
          <p className="text-sm text-muted-foreground">
            R12 — repeat customers, top customers and per-country sales.
            Customers are matched by their foreign phone number (§4.1).
          </p>
        </div>
        <ExportPdfButton
          filename={`customer-report-${csvDateStamp()}.pdf`}
          build={pdfPayload}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <DateFilter
            showAllTime
            value={detectPreset(from, to, "all")}
            from={from}
            to={to}
            onApply={(_preset, f, t) => {
              setFrom(f);
              setTo(t);
              apply(f, t);
            }}
          />
          <span className="ml-auto self-center text-sm text-muted-foreground">
            Showing {rangeLabel}
          </span>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Customers" value={String(report.totalCustomers)} sub="with at least one order" />
        <Kpi
          label="Repeat customers"
          value={String(report.repeatCustomers)}
          sub={`${report.repeatRatePct}% repeat rate (2+ sale orders)`}
        />
        <Kpi label="Sales value" value={money(report.totalSalesValue)} sub="excludes cancelled / returned" />
        <Kpi label="Avg per customer" value={money(report.avgValuePerCustomer)} />
      </div>

      {/* Per-country */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Per-country sales</CardTitle>
            <CardDescription>Where the paying customers live.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={report.byCountry.length === 0}
            onClick={() =>
              downloadCsv(
                `customers-by-country-${csvDateStamp()}.csv`,
                toCsv(
                  ["Country", "Customers", "Sale orders", "Sales value"],
                  report.byCountry.map((r) => [
                    r.country,
                    r.customers,
                    r.saleOrders,
                    r.salesValue,
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
            <CountryTable rows={report.byCountry} />
          </div>
        </CardContent>
      </Card>

      <CustomerTable
        title="Top customers"
        description={`Top ${report.topCustomers.length} by sales value.`}
        rows={report.topCustomers}
        emptyText="No customers in this range."
        onExport={() =>
          downloadCsv(
            `top-customers-${csvDateStamp()}.csv`,
            toCsv(CUSTOMER_HEADERS, customerCsvRows(report.topCustomers))
          )
        }
      />

      <CustomerTable
        title="Repeat customers"
        description="Customers who came back — 2+ sale orders, most orders first."
        rows={report.repeatRows}
        emptyText="No repeat customers yet in this range."
        onExport={() =>
          downloadCsv(
            `repeat-customers-${csvDateStamp()}.csv`,
            toCsv(CUSTOMER_HEADERS, customerCsvRows(report.repeatRows))
          )
        }
      />
    </div>
  );
}

function CountryTable({ rows }: { rows: CustomerReport["byCountry"] }) {
  const max = rows.reduce((m, r) => Math.max(m, r.salesValue), 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Country</TableHead>
          <TableHead className="w-[30%]">Volume</TableHead>
          <TableHead className="text-right">Customers</TableHead>
          <TableHead className="text-right">Sale orders</TableHead>
          <TableHead className="text-right">Sales value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.country}>
            <TableCell className="font-medium">{r.country}</TableCell>
            <TableCell>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary/70"
                  style={{ width: `${max > 0 ? (r.salesValue / max) * 100 : 0}%` }}
                />
              </div>
            </TableCell>
            <TableCell className="text-right">{r.customers}</TableCell>
            <TableCell className="text-right">{r.saleOrders}</TableCell>
            <TableCell className="text-right font-medium">{money(r.salesValue)}</TableCell>
          </TableRow>
        ))}
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
              No customers in this range.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function CustomerTable({
  title,
  description,
  rows,
  emptyText,
  onExport,
}: {
  title: string;
  description: string;
  rows: CustomerRow[];
  emptyText: string;
  onExport: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onExport} disabled={rows.length === 0}>
          Export CSV
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Country</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Sales value</TableHead>
                <TableHead>First order</TableHead>
                <TableHead>Last order</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.customerId}>
                  <TableCell className="font-medium">
                    {r.name}
                    {r.saleOrders >= 2 && (
                      <Badge variant="secondary" className="ml-2">repeat</Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.phoneForeign}</TableCell>
                  <TableCell>{r.country}</TableCell>
                  <TableCell className="text-right">
                    {r.saleOrders}
                    {r.orders !== r.saleOrders && (
                      <span
                        className="ml-1 text-xs text-muted-foreground"
                        title="including cancelled/returned"
                      >
                        /{r.orders}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">{money(r.salesValue)}</TableCell>
                  <TableCell>{formatDate(r.firstOrderAt)}</TableCell>
                  <TableCell>{formatDate(r.lastOrderAt)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    {emptyText}
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
