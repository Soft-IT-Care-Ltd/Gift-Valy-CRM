"use client";

// CORRECTIONS Orders §R8 — the "Steadfast Payments" section on the Courier
// page: payout list (date, invoice, status, parcels, net) with an expandable
// detail view mirroring their invoice breakdown (gross COD − delivery charge −
// COD charge = net + the cleared-consignment list), a paid today/this-month
// summary, the payout-wallet picker and the manual "Sync payments" button.
// Unmatched consignments are the flagged-for-review list; a payout whose
// numbers don't tie (net + charges ≠ gross) gets a warning badge.
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, formatDateTime } from "@/lib/format";
import { WALLET_TYPE_LABELS, type WalletOption } from "@/lib/wallet";
import {
  STEADFAST_PAYMENT_STATUS_LABELS,
  type SteadfastPaymentDetailRow,
  type SteadfastPaymentRow,
} from "@/lib/steadfast-payments-constants";

const UNASSIGNED = "unassigned";

export interface PaidSummary {
  net: number;
  parcels: number;
  payouts: number;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: SteadfastPaymentRow["status"] }) {
  return status === "PAID" ? (
    <Badge className="bg-green-100 text-green-800">
      {STEADFAST_PAYMENT_STATUS_LABELS.PAID}
    </Badge>
  ) : (
    <Badge className="bg-amber-100 text-amber-800">
      {STEADFAST_PAYMENT_STATUS_LABELS.PROCESSING}
    </Badge>
  );
}

export function SteadfastPaymentsCard({
  payments,
  wallets,
  payoutWalletId,
  paidToday,
  paidThisMonth,
  lastPaymentsSyncAt,
  enabled,
}: {
  payments: SteadfastPaymentRow[];
  wallets: WalletOption[];
  payoutWalletId: number | null;
  paidToday: PaidSummary;
  paidThisMonth: PaidSummary;
  lastPaymentsSyncAt: string | null;
  enabled: boolean;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [walletValue, setWalletValue] = useState(
    payoutWalletId != null ? String(payoutWalletId) : UNASSIGNED
  );
  const [expanded, setExpanded] = useState<number | null>(null);
  const [detail, setDetail] = useState<SteadfastPaymentDetailRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function syncPayments() {
    setSyncing(true);
    const res = await fetch("/api/couriers/steadfast/payments/sync", {
      method: "POST",
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setSyncing(false);
    if (!res?.ok) {
      toast.error(data?.error ?? "Payments sync failed");
      return;
    }
    const unmatched = data.unmatched
      ? ` · ${data.unmatched} unmatched flagged`
      : "";
    toast.success(
      `Payments synced — ${data.payments} checked, ${data.ordersSettled} order${
        data.ordersSettled === 1 ? "" : "s"
      } reconciled${unmatched}`
    );
    setExpanded(null);
    setDetail(null);
    router.refresh();
  }

  async function saveWallet(value: string) {
    setWalletValue(value);
    const walletId = value === UNASSIGNED ? null : Number(value);
    const res = await fetch("/api/couriers/steadfast/payments/wallet", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletId }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (!res?.ok) {
      toast.error(data?.error ?? "Failed to save payout wallet");
      setWalletValue(payoutWalletId != null ? String(payoutWalletId) : UNASSIGNED);
      return;
    }
    toast.success("Payout wallet saved");
    router.refresh();
  }

  async function toggleDetail(paymentId: number) {
    if (expanded === paymentId) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(paymentId);
    setDetail(null);
    setDetailLoading(true);
    const res = await fetch(`/api/couriers/steadfast/payments/${paymentId}`, {
      cache: "no-store",
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setDetailLoading(false);
    if (!res?.ok) {
      toast.error(data?.error ?? "Failed to load the payment detail");
      setExpanded(null);
      return;
    }
    setDetail(data);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Steadfast payments
          <span className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void syncPayments()}
              disabled={syncing || !enabled}
              title="Pull GET /payments and reconcile paid payouts"
            >
              <RefreshCw
                className={`mr-1 size-3.5 ${syncing ? "animate-spin" : ""}`}
              />
              {syncing ? "Syncing…" : "Sync payments"}
            </Button>
          </span>
        </CardTitle>
        <CardDescription>
          COD payouts pulled from their payments API. A <em>paid</em> payout
          auto-settles each cleared order at GROSS COD, posts the real delivery
          + COD charges as expenses, and lands the NET in the payout wallet.
          {lastPaymentsSyncAt
            ? ` Last payments sync ${formatDateTime(lastPaymentsSyncAt)}.`
            : " Never synced yet."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              Paid today: {money(paidToday.net)} ({paidToday.parcels} parcel
              {paidToday.parcels === 1 ? "" : "s"})
            </Badge>
            <Badge variant="secondary">
              This month: {money(paidThisMonth.net)} ({paidThisMonth.parcels}{" "}
              parcel{paidThisMonth.parcels === 1 ? "" : "s"} ·{" "}
              {paidThisMonth.payouts} payout
              {paidThisMonth.payouts === 1 ? "" : "s"})
            </Badge>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Payout wallet (NET deposits)</Label>
            <Select value={walletValue} onValueChange={(v) => void saveWallet(v)}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {wallets.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name} · {WALLET_TYPE_LABELS[w.type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Date</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Parcels</TableHead>
              <TableHead className="text-right">Net amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => (
              <Fragment key={p.id}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => void toggleDetail(p.id)}
                >
                  <TableCell className="text-muted-foreground">
                    {expanded === p.id ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {fmtDate(p.paymentDate)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.invoiceNo ?? `#${p.steadfastPaymentId}`}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <StatusBadge status={p.status} />
                      {!p.reconciles && p.status === "PAID" && (
                        <span
                          title="Net + charges ≠ gross on this invoice — review it"
                          className="text-red-600"
                        >
                          <AlertTriangle className="size-3.5" />
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.parcelCount}
                    {p.unmatchedCount > 0 && (
                      <span
                        className="ml-1 text-xs text-red-600"
                        title={`${p.unmatchedCount} consignment${
                          p.unmatchedCount === 1 ? "" : "s"
                        } not found in our system — flagged for review`}
                      >
                        ({p.unmatchedCount} unmatched)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {money(p.netAmount)}
                  </TableCell>
                </TableRow>
                {expanded === p.id && (
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={6} className="p-3">
                      {detailLoading || !detail ? (
                        <div className="py-2 text-sm text-muted-foreground">
                          Loading invoice…
                        </div>
                      ) : (
                        <div className="grid gap-3">
                          {/* Invoice breakdown — mirrors their payment invoice */}
                          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                            <span>
                              Amount delivered (gross COD):{" "}
                              <strong className="tabular-nums">
                                {money(detail.amountDelivered)}
                              </strong>
                            </span>
                            <span>
                              Delivery charge:{" "}
                              <strong className="tabular-nums">
                                −{money(detail.deliveryCharge)}
                              </strong>
                            </span>
                            <span>
                              COD charge:{" "}
                              <strong className="tabular-nums">
                                −{money(detail.codCharge)}
                              </strong>
                            </span>
                            <span>
                              Net:{" "}
                              <strong className="tabular-nums">
                                {money(detail.netAmount)}
                              </strong>
                            </span>
                            {!detail.reconciles && (
                              <span className="flex items-center gap-1 text-red-600">
                                <AlertTriangle className="size-3.5" /> doesn&apos;t
                                reconcile
                              </span>
                            )}
                          </div>
                          {detail.items.length > 0 ? (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Consignment</TableHead>
                                  <TableHead>Order</TableHead>
                                  <TableHead className="text-right">COD</TableHead>
                                  <TableHead className="text-right">Bill</TableHead>
                                  <TableHead>Reconciled</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {detail.items.map((it) => (
                                  <TableRow key={it.id}>
                                    <TableCell className="font-mono text-xs">
                                      {it.consignmentId ?? "—"}
                                    </TableCell>
                                    <TableCell>
                                      {it.orderId ? (
                                        <Link
                                          href={`/orders/${it.orderId}`}
                                          className="font-mono text-xs underline"
                                        >
                                          {it.orderNo}
                                        </Link>
                                      ) : (
                                        <Badge className="bg-red-100 text-red-800">
                                          Unmatched
                                          {it.invoice ? ` · ${it.invoice}` : ""}
                                        </Badge>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {money(it.codAmount)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {it.deliveryCharge != null
                                        ? money(it.deliveryCharge)
                                        : "—"}
                                    </TableCell>
                                    <TableCell>
                                      {it.settled ? (
                                        <Badge className="bg-green-100 text-green-800">
                                          COD recorded
                                        </Badge>
                                      ) : it.matched ? (
                                        <span className="text-xs text-muted-foreground">
                                          {detail.status === "PAID"
                                            ? "already reconciled"
                                            : "awaiting paid"}
                                        </span>
                                      ) : (
                                        <span className="text-xs text-red-600">
                                          review manually
                                        </span>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              No consignment breakdown on record yet — run
                              &ldquo;Sync payments&rdquo; to fetch the invoice
                              detail.
                            </p>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
            {payments.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-6 text-center text-muted-foreground"
                >
                  No payments synced yet. Request a payment in the Steadfast
                  panel, then run &ldquo;Sync payments&rdquo;.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
