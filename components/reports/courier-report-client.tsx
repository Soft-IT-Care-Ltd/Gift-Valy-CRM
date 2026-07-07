"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { CourierReport } from "@/lib/reports";

export function CourierReportClient({ report }: { report: CourierReport }) {
  const {
    pendingHandoverCount,
    counts,
    deliveredPct,
    returnedPct,
    codPending,
    pendingHandoverRows,
    codPendingRows,
    byCourier,
  } = report;

  function exportCodPending() {
    const headers = ["Order", "Courier", "Recipient", "District", "Delivered", "Age (days)", "COD"];
    const body = codPendingRows.map((r) => [
      r.orderNo,
      r.courier,
      r.recipientName,
      r.district,
      r.deliveredAt ? formatDate(r.deliveredAt) : "",
      r.ageDays,
      r.codAmount,
    ]);
    downloadCsv(`cod-pending-${csvDateStamp()}.csv`, toCsv(headers, body));
  }

  function exportByCourier() {
    const headers = [
      "Courier",
      "Handed to courier",
      "In transit",
      "Delivered",
      "Returned",
      "Total",
      "COD pending count",
      "COD pending amount",
    ];
    const body = byCourier.map((r) => [
      r.name,
      r.handedToCourier,
      r.inTransit,
      r.delivered,
      r.returned,
      r.total,
      r.codPendingCount,
      r.codPendingAmount,
    ]);
    downloadCsv(`courier-summary-${csvDateStamp()}.csv`, toCsv(headers, body));
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Courier report</h1>
        <p className="text-sm text-muted-foreground">
          R6 — handover, transit, delivery and return rates, plus COD pending with
          couriers (order-wise, aging).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Pending handover" value={String(pendingHandoverCount)} />
        <Kpi label="Handed to courier" value={String(counts.handedToCourier)} />
        <Kpi label="In transit" value={String(counts.inTransit)} />
        <Kpi label="Delivered" value={`${counts.delivered} · ${deliveredPct}%`} />
        <Kpi label="Returned" value={`${counts.returned} · ${returnedPct}%`} />
        <Kpi label="COD pending" value={money(codPending.amount)} sub={`${codPending.count} orders`} />
      </div>

      {/* Pending handover (SPEC §7) */}
      <Card>
        <CardHeader>
          <CardTitle>Pending handover ({pendingHandoverRows.length})</CardTitle>
          <CardDescription>
            Packed orders not yet given to a courier. Hand them over under{" "}
            <Link href="/courier/shipments" className="underline">
              Shipments
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>District</TableHead>
                <TableHead>Packed</TableHead>
                <TableHead className="text-right">Waiting</TableHead>
                <TableHead className="text-right">COD</TableHead>
                <TableHead>SE</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingHandoverRows.map((r) => (
                <TableRow key={r.orderId}>
                  <TableCell>
                    <Link href={`/orders/${r.orderId}`} className="font-mono text-sm underline">
                      {r.orderNo}
                    </Link>
                  </TableCell>
                  <TableCell>{r.recipientName}</TableCell>
                  <TableCell>{r.district}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {r.packedAt ? formatDate(r.packedAt) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={r.ageDays >= 3 ? "font-medium text-amber-700" : ""}>
                      {r.ageDays}d
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{money(r.codAmount)}</TableCell>
                  <TableCell className="text-muted-foreground">{r.salesExecutive}</TableCell>
                </TableRow>
              ))}
              {pendingHandoverRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    Nothing waiting for handover.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* COD pending with courier, aging (SPEC §7) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>COD pending with courier ({codPending.count})</CardTitle>
            <CardDescription>
              Delivered orders whose COD the courier still owes — oldest first.
            </CardDescription>
          </div>
          {codPendingRows.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCodPending}>
              Export CSV
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Courier</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>District</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead className="text-right">Age</TableHead>
                <TableHead className="text-right">COD</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codPendingRows.map((r) => (
                <TableRow key={r.shipmentId}>
                  <TableCell>
                    <Link href={`/orders/${r.orderId}`} className="font-mono text-sm underline">
                      {r.orderNo}
                    </Link>
                  </TableCell>
                  <TableCell>{r.courier}</TableCell>
                  <TableCell>{r.recipientName}</TableCell>
                  <TableCell>{r.district}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {r.deliveredAt ? formatDate(r.deliveredAt) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={r.ageDays >= 7 ? "font-medium text-amber-700" : ""}>
                      {r.ageDays}d
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium">{money(r.codAmount)}</TableCell>
                </TableRow>
              ))}
              {codPendingRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    No COD pending with couriers.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Per-courier breakdown */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>By courier</CardTitle>
            <CardDescription>Shipment mix and COD pending per company.</CardDescription>
          </div>
          {byCourier.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportByCourier}>
              Export CSV
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Courier</TableHead>
                <TableHead className="text-right">Handed over</TableHead>
                <TableHead className="text-right">In transit</TableHead>
                <TableHead className="text-right">Delivered</TableHead>
                <TableHead className="text-right">Returned</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">COD pending</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byCourier.map((r) => (
                <TableRow key={r.courierId}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right">{r.handedToCourier}</TableCell>
                  <TableCell className="text-right">{r.inTransit}</TableCell>
                  <TableCell className="text-right">{r.delivered}</TableCell>
                  <TableCell className="text-right">
                    {r.returned > 0 ? (
                      <Badge variant="destructive">{r.returned}</Badge>
                    ) : (
                      r.returned
                    )}
                  </TableCell>
                  <TableCell className="text-right">{r.total}</TableCell>
                  <TableCell className="text-right">
                    {r.codPendingAmount > 0 ? (
                      <span>
                        {money(r.codPendingAmount)}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({r.codPendingCount})
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {byCourier.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    No couriers yet.
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
