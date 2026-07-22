"use client";

// CORRECTIONS Orders §R8 + Round 2 §2.7 — the "Steadfast Payments" section on
// the Courier page: payout list (date, invoice, status, parcels, net) with an
// expandable PAYOUT REPORT: their invoice breakdown (gross COD − delivery
// charge − COD charge = net), total paid vs Σ our expected nets, and the
// per-consignment justification table (their figures vs our computed net
// receivable, verdict badges, and the Admin/Accounts resolve flow for
// discrepancies — accept their figure with a reason, or mark disputed).
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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
  PAYOUT_MATCH_TOLERANCE,
  STEADFAST_PAYMENT_STATUS_LABELS,
  type SteadfastPaymentDetailRow,
  type SteadfastPaymentItemRow,
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

// §2.7 — the per-consignment verdict badge.
function ReconcileBadge({ item }: { item: SteadfastPaymentItemRow }) {
  if (!item.matched) {
    return <Badge className="bg-red-100 text-red-800">Unmatched</Badge>;
  }
  switch (item.reconcileStatus) {
    case "MATCHED":
      return <Badge className="bg-green-100 text-green-800">Matched ✓</Badge>;
    case "MISMATCH":
      return <Badge className="bg-red-100 text-red-800">⚠ Mismatch</Badge>;
    case "ACCEPTED":
      return (
        <Badge
          className="bg-blue-100 text-blue-800"
          title={item.resolveNote ?? undefined}
        >
          Accepted
        </Badge>
      );
    case "DISPUTED":
      return (
        <Badge
          className="bg-orange-100 text-orange-800"
          title={item.resolveNote ?? undefined}
        >
          Disputed
        </Badge>
      );
    default:
      return <Badge variant="outline">Pending</Badge>;
  }
}

// Signed money difference, red when it exceeds the match tolerance.
function Diff({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  const off = Math.abs(value) > PAYOUT_MATCH_TOLERANCE;
  return (
    <span className={off ? "font-medium text-red-600" : "text-muted-foreground"}>
      {value > 0 ? "+" : ""}
      {money(value)}
    </span>
  );
}

// §2.7 — per-consignment difference: their net vs our expected when both are
// known, else their gross vs our recorded COD.
function itemDifference(item: SteadfastPaymentItemRow): number | null {
  if (item.paidNet != null && item.expectedNet != null) {
    return Math.round((item.paidNet - item.expectedNet) * 100) / 100;
  }
  if (item.ourGross != null) {
    return Math.round((item.codAmount - item.ourGross) * 100) / 100;
  }
  return null;
}

export function SteadfastPaymentsCard({
  payments,
  wallets,
  payoutWalletId,
  paidToday,
  paidThisMonth,
  lastPaymentsSyncAt,
  enabled,
  canResolve,
}: {
  payments: SteadfastPaymentRow[];
  wallets: WalletOption[];
  payoutWalletId: number | null;
  paidToday: PaidSummary;
  paidThisMonth: PaidSummary;
  lastPaymentsSyncAt: string | null;
  enabled: boolean;
  canResolve: boolean; // §2.7 — payments.verify (Admin/Accounts)
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [walletValue, setWalletValue] = useState(
    payoutWalletId != null ? String(payoutWalletId) : UNASSIGNED
  );
  const [expanded, setExpanded] = useState<number | null>(null);
  const [detail, setDetail] = useState<SteadfastPaymentDetailRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // §2.7 resolve dialog state
  const [resolveItem, setResolveItem] = useState<SteadfastPaymentItemRow | null>(
    null
  );
  const [resolveNote, setResolveNote] = useState("");
  const [resolving, setResolving] = useState<"ACCEPT" | "DISPUTE" | null>(null);

  async function refreshDetail(paymentId: number) {
    const res = await fetch(`/api/couriers/steadfast/payments/${paymentId}`, {
      cache: "no-store",
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (res?.ok) setDetail(data);
  }

  async function submitResolve(action: "ACCEPT" | "DISPUTE") {
    if (!resolveItem || expanded == null) return;
    if (action === "ACCEPT" && !resolveNote.trim()) {
      toast.error("A reason is required to accept their figure");
      return;
    }
    setResolving(action);
    const res = await fetch(
      `/api/couriers/steadfast/payments/${expanded}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: resolveItem.id,
          action,
          note: resolveNote.trim() || null,
        }),
      }
    ).catch(() => null);
    const data = await res?.json().catch(() => null);
    setResolving(null);
    if (!res?.ok) {
      toast.error(data?.error ?? "Failed to resolve the discrepancy");
      return;
    }
    toast.success(
      action === "ACCEPT"
        ? `Accepted — their figure recorded${data.completed ? ", order completed" : ""}${data.paymentReconciled ? ", payout reconciled" : ""}`
        : "Marked disputed"
    );
    setResolveItem(null);
    setResolveNote("");
    await refreshDetail(expanded);
    router.refresh();
  }

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
    const extras = [
      data.completed ? `${data.completed} auto-completed` : null,
      data.discrepancies ? `${data.discrepancies} discrepancy flagged` : null,
      data.unmatched ? `${data.unmatched} unmatched` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    toast.success(
      `Payments synced — ${data.payments} checked, ${data.ordersSettled} order${
        data.ordersSettled === 1 ? "" : "s"
      } reconciled${extras ? ` · ${extras}` : ""}`
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
                    {p.discrepancyCount > 0 && (
                      <span
                        className="ml-1 text-xs font-medium text-red-600"
                        title={`${p.discrepancyCount} consignment${
                          p.discrepancyCount === 1 ? "" : "s"
                        } with a payout discrepancy — resolve below`}
                      >
                        ⚠ {p.discrepancyCount}
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
                          {/* §2.7 payout report roll-up: total paid vs Σ our
                              expected nets + discrepancy count */}
                          {detail.expectedNetSum != null && (
                            <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border bg-background px-3 py-2 text-sm">
                              <span>
                                Σ our expected nets:{" "}
                                <strong className="tabular-nums">
                                  {money(detail.expectedNetSum)}
                                </strong>
                              </span>
                              <span>
                                Their total paid:{" "}
                                <strong className="tabular-nums">
                                  {money(detail.netAmount)}
                                </strong>
                              </span>
                              <span>
                                Paid vs expected:{" "}
                                <Diff value={detail.paidVsExpectedDiff} />
                              </span>
                              <span>
                                Discrepancies:{" "}
                                <strong
                                  className={
                                    detail.discrepancyCount > 0
                                      ? "text-red-600"
                                      : undefined
                                  }
                                >
                                  {detail.discrepancyCount}
                                </strong>
                              </span>
                              {detail.reconciledAt && (
                                <span className="text-muted-foreground">
                                  reconciled {formatDateTime(detail.reconciledAt)}
                                </span>
                              )}
                            </div>
                          )}
                          {detail.items.length > 0 ? (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Consignment</TableHead>
                                  <TableHead>Order</TableHead>
                                  <TableHead className="text-right">
                                    Their COD
                                  </TableHead>
                                  <TableHead className="text-right">
                                    Our COD
                                  </TableHead>
                                  <TableHead className="text-right">
                                    Our net recv.
                                  </TableHead>
                                  <TableHead className="text-right">
                                    Their net
                                  </TableHead>
                                  <TableHead className="text-right">
                                    Diff
                                  </TableHead>
                                  <TableHead>Verdict</TableHead>
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
                                        <span className="flex items-center gap-1.5">
                                          <Link
                                            href={`/orders/${it.orderId}`}
                                            className="font-mono text-xs underline"
                                          >
                                            {it.orderNo}
                                          </Link>
                                          {it.orderStatus === "COMPLETED" && (
                                            <Badge
                                              variant="outline"
                                              className="bg-green-50 text-[10px] text-green-700"
                                            >
                                              Completed
                                            </Badge>
                                          )}
                                        </span>
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
                                      {it.ourGross != null
                                        ? money(it.ourGross)
                                        : "—"}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {it.expectedNet != null
                                        ? money(it.expectedNet)
                                        : "—"}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {it.paidNet != null
                                        ? money(it.paidNet)
                                        : "—"}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      <Diff value={itemDifference(it)} />
                                    </TableCell>
                                    <TableCell>
                                      <span className="flex items-center gap-1.5">
                                        <ReconcileBadge item={it} />
                                        {it.settled && (
                                          <span
                                            className="text-xs text-green-700"
                                            title="COD payment recorded on the order"
                                          >
                                            ✓ COD
                                          </span>
                                        )}
                                        {canResolve &&
                                          detail.status === "PAID" &&
                                          (it.reconcileStatus === "MISMATCH" ||
                                            it.reconcileStatus ===
                                              "DISPUTED") && (
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className="h-6 px-2 text-xs"
                                              onClick={() => {
                                                setResolveItem(it);
                                                setResolveNote("");
                                              }}
                                            >
                                              Resolve
                                            </Button>
                                          )}
                                      </span>
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

      {/* §2.7 — resolve a payout discrepancy (Admin/Accounts) */}
      <Dialog
        open={resolveItem != null}
        onOpenChange={(open) => {
          if (!open) {
            setResolveItem(null);
            setResolveNote("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve payout discrepancy</DialogTitle>
            <DialogDescription>
              {resolveItem && (
                <>
                  Order{" "}
                  <span className="font-mono">{resolveItem.orderNo ?? "—"}</span>
                  : their COD {money(resolveItem.codAmount)}
                  {resolveItem.ourGross != null &&
                    ` vs ours ${money(resolveItem.ourGross)}`}
                  {resolveItem.expectedNet != null &&
                    ` · our net receivable ${money(resolveItem.expectedNet)}`}
                  {resolveItem.paidNet != null &&
                    ` · their net ${money(resolveItem.paidNet)}`}
                  . Accepting records THEIR figure as the COD payment and lets
                  the order complete; disputing holds everything until it is
                  settled with Steadfast.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="resolve-note">
              Reason{" "}
              <span className="text-muted-foreground">
                (required to accept)
              </span>
            </Label>
            <Textarea
              id="resolve-note"
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder="e.g. COD reduced at delivery — customer paid the rest by bKash"
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => void submitResolve("DISPUTE")}
              disabled={resolving != null}
            >
              {resolving === "DISPUTE" ? "Saving…" : "Mark disputed"}
            </Button>
            <Button
              onClick={() => void submitResolve("ACCEPT")}
              disabled={resolving != null || !resolveNote.trim()}
            >
              {resolving === "ACCEPT" ? "Saving…" : "Accept their figure"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
