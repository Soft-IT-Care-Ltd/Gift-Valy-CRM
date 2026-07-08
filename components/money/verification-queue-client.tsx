"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { money, formatDateTime } from "@/lib/format";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_TYPE_LABELS,
  type PaymentMethodValue,
  type PaymentTypeValue,
} from "@/lib/order-constants";

export interface VerifyPaymentRow {
  id: number;
  paymentDate: string;
  orderId: number;
  orderNo: string;
  customerName: string;
  type: PaymentTypeValue;
  method: PaymentMethodValue;
  walletName: string | null;
  amount: number;
  transactionId: string | null;
  senderNumber: string | null;
  screenshotUrl: string | null;
  isVerified: boolean;
  isRejected: boolean;
  rejectionReason: string | null;
}

type Tab = "pending" | "rejected" | "verified";

export function VerificationQueueClient({ rows }: { rows: VerifyPaymentRow[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("pending");
  const [busy, setBusy] = useState<number | null>(null);

  // Reject dialog
  const [rejectRow, setRejectRow] = useState<VerifyPaymentRow | null>(null);
  const [reason, setReason] = useState("");

  const pending = rows.filter((r) => !r.isVerified && !r.isRejected);
  const rejected = rows.filter((r) => r.isRejected);
  const verified = rows.filter((r) => r.isVerified);
  const visible = tab === "pending" ? pending : tab === "rejected" ? rejected : verified;
  const pendingTotal = pending.reduce((s, r) => s + r.amount, 0);

  async function resolve(id: number, action: "verify" | "reject" | "reopen", rsn?: string) {
    setBusy(id);
    const res = await fetch(`/api/payments/${id}/verify`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason: rsn ?? null }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to update payment");
      return false;
    }
    const data = await res.json();
    const msg =
      action === "verify"
        ? "Payment verified"
        : action === "reject"
          ? `Payment rejected — order due is now ${money(data.due)}`
          : "Payment reopened";
    toast.success(msg);
    router.refresh();
    return true;
  }

  async function submitReject() {
    if (!rejectRow || reason.trim().length < 3) return;
    const ok = await resolve(rejectRow.id, "reject", reason.trim());
    if (ok) {
      setRejectRow(null);
      setReason("");
    }
  }

  const emptyText: Record<Tab, string> = {
    pending: "Nothing awaiting verification. 🎉",
    rejected: "No rejected payments.",
    verified: "No recently verified payments.",
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Payment verification</h1>
        <p className="text-sm text-muted-foreground">
          Check each payment against the wallet/bank statement, then{" "}
          <span className="font-medium">Verify</span> it — or{" "}
          <span className="font-medium">Reject</span> it if the money never
          arrived (fake txn, wrong amount). Rejecting restores the order&apos;s due.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Awaiting verification" value={String(pending.length)} sub={money(pendingTotal)} />
        <Kpi label="Rejected (not received)" value={String(rejected.length)} sub="last 30 days" />
        <Kpi label="Recently verified" value={String(verified.length)} sub="last 30 days" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={tab === "pending" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("pending")}
        >
          Awaiting ({pending.length})
        </Button>
        <Button
          variant={tab === "rejected" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("rejected")}
        >
          Rejected ({rejected.length})
        </Button>
        <Button
          variant={tab === "verified" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("verified")}
        >
          Verified ({verified.length})
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {tab === "pending"
              ? "Awaiting verification"
              : tab === "rejected"
                ? "Rejected — money not received"
                : "Recently verified"}
          </CardTitle>
          <CardDescription>
            {tab === "pending"
              ? "Oldest first. Verify once the money is confirmed in the wallet, or reject it if it never arrived."
              : tab === "rejected"
                ? "Payments Accounts marked as not received. Reopen to move one back to the queue."
                : "Reopen if a sign-off was a mistake."}
          </CardDescription>
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
                  <TableHead>Txn ID</TableHead>
                  <TableHead>Sender</TableHead>
                  <TableHead>Proof</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((p) => (
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
                    <TableCell className="font-mono text-xs">
                      {p.transactionId ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.senderNumber ?? "—"}
                    </TableCell>
                    <TableCell>
                      {p.screenshotUrl ? (
                        <a
                          href={p.screenshotUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm underline"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {p.type === "REFUND" ? (
                        <span className="text-red-600">−{money(p.amount)}</span>
                      ) : (
                        money(p.amount)
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {tab === "pending" ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            disabled={busy === p.id}
                            onClick={() => resolve(p.id, "verify")}
                          >
                            Verify
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={busy === p.id}
                            onClick={() => {
                              setRejectRow(p);
                              setReason("");
                            }}
                          >
                            Reject
                          </Button>
                        </div>
                      ) : tab === "rejected" ? (
                        <div className="flex items-center justify-end gap-2">
                          {p.rejectionReason && (
                            <span
                              className="max-w-[16rem] truncate text-xs text-muted-foreground"
                              title={p.rejectionReason}
                            >
                              “{p.rejectionReason}”
                            </span>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy === p.id}
                            onClick={() => resolve(p.id, "reopen")}
                          >
                            Reopen
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy === p.id}
                          onClick={() => resolve(p.id, "reopen")}
                        >
                          Reopen
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={11}
                      className="py-6 text-center text-muted-foreground"
                    >
                      {emptyText[tab]}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Reject dialog — reason required */}
      <Dialog open={!!rejectRow} onOpenChange={(o) => !o && setRejectRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject payment — {rejectRow?.orderNo}</DialogTitle>
            <DialogDescription>
              Mark this {rejectRow ? money(rejectRow.amount) : ""} payment as not
              received. It will be removed from the order&apos;s paid amount and
              from collections. Add a reason for the record.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>Reason</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. No matching entry in the bKash statement / customer sent a fake txn ID"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectRow(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={submitReject}
              disabled={reason.trim().length < 3 || busy === rejectRow?.id}
            >
              Reject payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
