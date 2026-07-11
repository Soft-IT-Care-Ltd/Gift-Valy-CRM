"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { money, formatDate, formatDateTime } from "@/lib/format";
import { toCsv, downloadCsv, csvDateStamp } from "@/lib/csv";
import { ExportPdfButton } from "@/components/reports/export-pdf-button";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_TYPE_LABELS,
  type OrderStatusValue,
} from "@/lib/order-constants";
import type { ReportPdfPayload } from "@/lib/report-pdf";
import type { CollectionReport } from "@/lib/reports";

export function CollectionReportClient({
  report,
  from,
  to,
}: {
  report: CollectionReport;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [fromDate, setFromDate] = useState(from);
  const [toDate, setToDate] = useState(to);

  // Client-side breakdown filters over the detail list (§8 "by method/wallet").
  const [fMethod, setFMethod] = useState("ALL");
  const [fWallet, setFWallet] = useState("ALL");
  const [fVerified, setFVerified] = useState("ALL");

  function applyRange() {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    router.push(`/reports/collection${params.toString() ? `?${params}` : ""}`);
  }
  function resetRange() {
    setFromDate("");
    setToDate("");
    router.push("/reports/collection");
  }

  const walletFilterOptions = report.byWallet.map((w) => ({
    key: w.walletId === null ? "none" : String(w.walletId),
    name: w.walletName,
  }));

  const filteredPayments = useMemo(() => {
    return report.payments.filter((p) => {
      if (fMethod !== "ALL" && p.method !== fMethod) return false;
      if (fWallet !== "ALL") {
        const key = p.walletId === null ? "none" : String(p.walletId);
        if (key !== fWallet) return false;
      }
      if (fVerified === "VERIFIED" && !p.isVerified) return false;
      if (fVerified === "UNVERIFIED" && p.isVerified) return false;
      return true;
    });
  }, [report.payments, fMethod, fWallet, fVerified]);

  function exportPayments() {
    const headers = [
      "Date",
      "Order",
      "Customer",
      "Type",
      "Method",
      "Wallet",
      "Txn ID",
      "Amount",
      "Verified",
    ];
    const body = filteredPayments.map((p) => [
      formatDateTime(p.paymentDate),
      p.orderNo,
      p.customerName,
      PAYMENT_TYPE_LABELS[p.type],
      PAYMENT_METHOD_LABELS[p.method],
      p.walletName ?? "Unassigned",
      p.transactionId ?? "",
      p.type === "REFUND" ? -p.amount : p.amount,
      p.isVerified ? "Yes" : "No",
    ]);
    downloadCsv(`collection-payments-${csvDateStamp()}.csv`, toCsv(headers, body));
  }

  function exportDues() {
    const headers = [
      "Order",
      "Customer",
      "SE",
      "Status",
      "Created",
      "Total",
      "Paid",
      "Due",
      "Age (days)",
      "Bucket",
    ];
    const body = report.dues.rows.map((r) => [
      r.orderNo,
      r.customerName,
      r.salesExecutive,
      ORDER_STATUS_LABELS[r.status as OrderStatusValue] ?? r.status,
      formatDate(r.createdAt),
      r.totalAmount,
      r.paid,
      r.dueAmount,
      r.ageDays,
      r.bucket,
    ]);
    downloadCsv(`dues-outstanding-${csvDateStamp()}.csv`, toCsv(headers, body));
  }

  const rangeLabel = `${formatDate(report.range.from)} → ${formatDate(report.range.to)}`;

  function pdfPayload(): ReportPdfPayload {
    const methodRow = report.byMethod.find((m) => m.method === fMethod);
    const payFilters = [
      fMethod !== "ALL"
        ? `Method: ${methodRow ? PAYMENT_METHOD_LABELS[methodRow.method] : fMethod}`
        : null,
      fWallet !== "ALL"
        ? `Wallet: ${walletFilterOptions.find((w) => w.key === fWallet)?.name ?? fWallet}`
        : null,
      fVerified === "VERIFIED"
        ? "Verified only"
        : fVerified === "UNVERIFIED"
          ? "Unverified only"
          : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      title: "Collection Report (R7)",
      subtitle: rangeLabel,
      landscape: true,
      kpis: [
        {
          label: "Net collected",
          value: `${money(report.netCollected)} · ${report.paymentCount} payments`,
        },
        { label: "Collected (in)", value: money(report.totalCollected) },
        { label: "Refunded (out)", value: money(report.totalRefunded) },
        {
          label: "Dues outstanding",
          value: `${money(report.dues.totalOutstanding)} · ${report.dues.orderCount} orders`,
        },
        {
          label: "Verified",
          value: `${money(report.verified.amount)} · ${report.verified.count} payments`,
        },
        {
          label: "Unverified",
          value: `${money(report.unverified.amount)} · ${report.unverified.count} payments`,
        },
        {
          label: "Rejected",
          value: `${money(report.rejected.amount)} · ${report.rejected.count} payments`,
        },
      ],
      sections: [
        {
          heading: "By method",
          note: "Collected, refunded and net per method.",
          headers: ["Method", "Collected", "Refunded", "Net", "Count"],
          aligns: ["l", "r", "r", "r", "r"],
          rows: report.byMethod.map((m) => [
            PAYMENT_METHOD_LABELS[m.method],
            money(m.collected),
            m.refunded > 0 ? `−${money(m.refunded)}` : "—",
            money(m.net),
            m.count,
          ]),
        },
        {
          heading: "By wallet",
          note: "Which company account received the money.",
          headers: ["Wallet", "Collected", "Refunded", "Net", "Count"],
          aligns: ["l", "r", "r", "r", "r"],
          rows: report.byWallet.map((w) => [
            w.walletId === null
              ? `${w.walletName} (COD not posted)`
              : w.walletName,
            money(w.collected),
            w.refunded > 0 ? `−${money(w.refunded)}` : "—",
            money(w.net),
            w.count,
          ]),
        },
        {
          heading: `Payments (${filteredPayments.length})`,
          note: payFilters
            ? `Filtered — ${payFilters}.`
            : "Every payment in the range.",
          headers: [
            "Date",
            "Order",
            "Customer",
            "Type",
            "Method",
            "Wallet",
            "Amount",
            "Verified",
          ],
          aligns: ["l", "l", "l", "l", "l", "l", "r", "l"],
          rows: filteredPayments.map((p) => [
            formatDateTime(p.paymentDate),
            p.orderNo,
            p.customerName,
            PAYMENT_TYPE_LABELS[p.type],
            PAYMENT_METHOD_LABELS[p.method],
            p.walletName ?? "—",
            p.type === "REFUND" ? `−${money(p.amount)}` : money(p.amount),
            p.isVerified ? "Verified" : "Unverified",
          ]),
        },
        {
          heading: "Dues aging buckets",
          headers: ["Bucket", "Orders", "Amount"],
          aligns: ["l", "r", "r"],
          rows: report.dues.buckets.map((b) => [
            b.label,
            b.count,
            money(b.amount),
          ]),
        },
        {
          heading: `Dues outstanding — ${money(report.dues.totalOutstanding)} across ${report.dues.orderCount} orders`,
          note: "Live snapshot of unpaid orders (independent of the date range), oldest first.",
          headers: [
            "Order",
            "Customer",
            "SE",
            "Status",
            "Created",
            "Total",
            "Paid",
            "Due",
            "Age",
          ],
          aligns: ["l", "l", "l", "l", "l", "r", "r", "r", "r"],
          rows: report.dues.rows.map((r) => [
            r.orderNo,
            r.customerName,
            r.salesExecutive,
            ORDER_STATUS_LABELS[r.status as OrderStatusValue] ?? r.status,
            formatDate(r.createdAt),
            money(r.totalAmount),
            money(r.paid),
            money(r.dueAmount),
            `${r.ageDays}d`,
          ]),
        },
      ],
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Collection report</h1>
          <p className="text-sm text-muted-foreground">
            R7 — collections by method, by wallet, verified vs unverified, and total
            dues outstanding with order-wise aging.
          </p>
        </div>
        <ExportPdfButton
          filename={`collection-report-${csvDateStamp()}.pdf`}
          build={pdfPayload}
        />
      </div>

      {/* Date range (§8 "by date range") */}
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Net collected"
          value={money(report.netCollected)}
          sub={`${report.paymentCount} payments`}
        />
        <Kpi label="Collected (in)" value={money(report.totalCollected)} />
        <Kpi label="Refunded (out)" value={money(report.totalRefunded)} />
        <Kpi
          label="Dues outstanding"
          value={money(report.dues.totalOutstanding)}
          sub={`${report.dues.orderCount} orders`}
        />
      </div>

      {/* Verified vs unverified vs rejected (§8) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Verified collections</CardDescription>
            <CardTitle className="text-2xl text-green-700">
              {money(report.verified.amount)}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {report.verified.count} payments signed off against statements
            </p>
          </CardHeader>
        </Card>
        <Card className={report.unverified.count > 0 ? "border-amber-300" : undefined}>
          <CardHeader className="pb-2">
            <CardDescription>Unverified (flagged)</CardDescription>
            <CardTitle className="text-2xl text-amber-700">
              {money(report.unverified.amount)}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {report.unverified.count} awaiting verification —{" "}
              <Link href="/money/verification" className="underline">
                open queue
              </Link>
            </p>
          </CardHeader>
        </Card>
        <Card className={report.rejected.count > 0 ? "border-red-300" : undefined}>
          <CardHeader className="pb-2">
            <CardDescription>Rejected (not received)</CardDescription>
            <CardTitle className="text-2xl text-red-600">
              {money(report.rejected.amount)}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {report.rejected.count} payments excluded from collections
            </p>
          </CardHeader>
        </Card>
      </div>

      {/* By method + by wallet */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By method</CardTitle>
            <CardDescription>Collected, refunded and net per method.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead className="text-right">Refunded</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.byMethod.map((m) => (
                  <TableRow key={m.method}>
                    <TableCell className="font-medium">
                      {PAYMENT_METHOD_LABELS[m.method]}
                    </TableCell>
                    <TableCell className="text-right">{money(m.collected)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {m.refunded > 0 ? `−${money(m.refunded)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {money(m.net)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {m.count}
                    </TableCell>
                  </TableRow>
                ))}
                {report.byMethod.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                      No payments in this range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By wallet</CardTitle>
            <CardDescription>
              Which company account received the money.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wallet</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead className="text-right">Refunded</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.byWallet.map((w) => (
                  <TableRow key={w.walletId === null ? "none" : w.walletId}>
                    <TableCell className="font-medium">
                      {w.walletName}
                      {w.walletId === null && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (COD not posted)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{money(w.collected)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {w.refunded > 0 ? `−${money(w.refunded)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {money(w.net)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {w.count}
                    </TableCell>
                  </TableRow>
                ))}
                {report.byWallet.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                      No payments in this range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Payment detail with filters */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Payments ({filteredPayments.length})</CardTitle>
            <CardDescription>
              Every payment in the range. Filter by method, wallet or verification.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={fMethod} onValueChange={setFMethod}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All methods</SelectItem>
                {report.byMethod.map((m) => (
                  <SelectItem key={m.method} value={m.method}>
                    {PAYMENT_METHOD_LABELS[m.method]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={fWallet} onValueChange={setFWallet}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Wallet" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All wallets</SelectItem>
                {walletFilterOptions.map((w) => (
                  <SelectItem key={w.key} value={w.key}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={fVerified} onValueChange={setFVerified}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Verified" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="VERIFIED">Verified</SelectItem>
                <SelectItem value="UNVERIFIED">Unverified</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={exportPayments}
              disabled={filteredPayments.length === 0}
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
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Wallet</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Verified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(p.paymentDate)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/orders/${p.orderId}`}
                        className="font-mono text-sm underline"
                      >
                        {p.orderNo}
                      </Link>
                    </TableCell>
                    <TableCell>{p.customerName}</TableCell>
                    <TableCell>{PAYMENT_TYPE_LABELS[p.type]}</TableCell>
                    <TableCell>{PAYMENT_METHOD_LABELS[p.method]}</TableCell>
                    <TableCell>
                      {p.walletName ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.type === "REFUND" ? (
                        <span className="text-red-600">−{money(p.amount)}</span>
                      ) : (
                        money(p.amount)
                      )}
                    </TableCell>
                    <TableCell>
                      {p.isVerified ? (
                        <Badge variant="secondary">Verified</Badge>
                      ) : (
                        <Badge variant="outline">Unverified</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredPayments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                      No payments match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dues outstanding + aging (§8) */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>
              Dues outstanding — {money(report.dues.totalOutstanding)} across{" "}
              {report.dues.orderCount} orders
            </CardTitle>
            <CardDescription>
              Live snapshot of unpaid orders (independent of the date range),
              oldest first.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={exportDues}
            disabled={report.dues.rows.length === 0}
          >
            Export CSV
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            {report.dues.buckets.map((b) => (
              <div key={b.label} className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">{b.label}</div>
                <div className="text-lg font-semibold">{money(b.amount)}</div>
                <div className="text-xs text-muted-foreground">
                  {b.count} orders
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>SE</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.dues.rows.map((r) => (
                  <TableRow key={r.orderId}>
                    <TableCell>
                      <Link
                        href={`/orders/${r.orderId}`}
                        className="font-mono text-sm underline"
                      >
                        {r.orderNo}
                      </Link>
                    </TableCell>
                    <TableCell>{r.customerName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.salesExecutive}
                    </TableCell>
                    <TableCell>
                      {ORDER_STATUS_LABELS[r.status as OrderStatusValue] ??
                        r.status}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(r.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {money(r.totalAmount)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {money(r.paid)}
                    </TableCell>
                    <TableCell className="text-right font-medium text-amber-700">
                      {money(r.dueAmount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={r.ageDays >= 16 ? "font-medium text-amber-700" : ""}>
                        {r.ageDays}d
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {report.dues.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">
                      No outstanding dues. 🎉
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
