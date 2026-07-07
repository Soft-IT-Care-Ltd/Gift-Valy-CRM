"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { money, formatDate } from "@/lib/format";
import { toCsv, downloadCsv, csvDateStamp } from "@/lib/csv";
import type { CodPendingRow } from "@/lib/courier";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function CodReconcileClient({
  rows,
  today,
}: {
  rows: CodPendingRow[];
  today: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [receivedDate, setReceivedDate] = useState(today);
  const [saving, setSaving] = useState(false);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.shipmentId)));
  }

  const totals = useMemo(() => {
    const chosen = rows.filter((r) => selected.has(r.shipmentId));
    return {
      count: chosen.length,
      cod: round2(chosen.reduce((s, r) => s + r.codAmount, 0)),
      fee: round2(chosen.reduce((s, r) => s + r.fee, 0)),
    };
  }, [rows, selected]);

  const pendingTotal = useMemo(
    () => round2(rows.reduce((s, r) => s + r.codAmount, 0)),
    [rows]
  );

  async function markReceived() {
    if (totals.count === 0) return;
    setSaving(true);
    const res = await fetch("/api/shipments/cod", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shipmentIds: [...selected],
        receivedDate,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to reconcile COD");
      return;
    }
    const result = await res.json();
    toast.success(
      `${result.reconciled} reconciled · COD ${money(result.totalCod)} · fee ${money(result.totalFee)}`
    );
    setSelected(new Set());
    router.refresh();
  }

  function exportCsv() {
    const headers = [
      "Order",
      "Courier",
      "Recipient",
      "District",
      "Delivered",
      "Age (days)",
      "COD",
      "Fee %",
      "Fee (est)",
    ];
    const body = rows.map((r) => [
      r.orderNo,
      r.courier,
      r.recipientName,
      r.district,
      r.deliveredAt ? formatDate(r.deliveredAt) : "",
      r.ageDays,
      r.codAmount,
      r.feePercent,
      r.fee,
    ]);
    downloadCsv(`cod-pending-${csvDateStamp()}.csv`, toCsv(headers, body));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">COD reconciliation</h1>
          <p className="text-sm text-muted-foreground">
            SPEC §7 — match courier remittance against delivered orders. Marking
            received records the COD payment and the courier fee expense.
          </p>
        </div>
        {rows.length > 0 && (
          <Button variant="outline" onClick={exportCsv}>
            Export CSV
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>COD pending with courier</CardDescription>
            <CardTitle className="text-2xl">{money(pendingTotal)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Selected COD</CardDescription>
            <CardTitle className="text-2xl">{money(totals.cod)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Selected courier fee (est.)</CardDescription>
            <CardTitle className="text-2xl">{money(totals.fee)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Delivered — COD not yet received ({rows.length})</CardTitle>
              <CardDescription>
                Select the orders the courier has remitted, then mark received.
              </CardDescription>
            </div>
            <div className="flex items-end gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">Received date</Label>
                <Input
                  type="date"
                  value={receivedDate}
                  onChange={(e) => setReceivedDate(e.target.value)}
                  className="w-40"
                />
              </div>
              <Button
                onClick={markReceived}
                disabled={saving || totals.count === 0 || !receivedDate}
              >
                {saving ? "Saving…" : `Mark COD received (${totals.count})`}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Courier</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead className="text-right">Age</TableHead>
                <TableHead className="text-right">COD</TableHead>
                <TableHead className="text-right">Fee (est.)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.shipmentId} data-state={selected.has(r.shipmentId) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(r.shipmentId)}
                      onCheckedChange={() => toggle(r.shipmentId)}
                      aria-label={`Select ${r.orderNo}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Link href={`/orders/${r.orderId}`} className="font-mono text-sm underline">
                      {r.orderNo}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.district}</div>
                  </TableCell>
                  <TableCell>{r.courier}</TableCell>
                  <TableCell>{r.recipientName}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {r.deliveredAt ? formatDate(r.deliveredAt) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={r.ageDays >= 7 ? "font-medium text-amber-700" : ""}>
                      {r.ageDays}d
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium">{money(r.codAmount)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {money(r.fee)} · {r.feePercent}%
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    No COD pending with couriers. 🎉
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
