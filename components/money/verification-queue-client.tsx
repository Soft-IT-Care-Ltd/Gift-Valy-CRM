"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
}

export function VerificationQueueClient({ rows }: { rows: VerifyPaymentRow[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"pending" | "verified">("pending");
  const [busy, setBusy] = useState<number | null>(null);

  const pending = rows.filter((r) => !r.isVerified);
  const verified = rows.filter((r) => r.isVerified);
  const visible = tab === "pending" ? pending : verified;
  const pendingTotal = pending.reduce((s, r) => s + r.amount, 0);

  async function setVerified(id: number, isVerified: boolean) {
    setBusy(id);
    const res = await fetch(`/api/payments/${id}/verify`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isVerified }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to update payment");
      return;
    }
    toast.success(isVerified ? "Payment verified" : "Payment flagged unverified");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Payment verification</h1>
        <p className="text-sm text-muted-foreground">
          Check each payment against the wallet/bank statement, then verify.
          Unverified payments stay flagged.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Awaiting verification" value={String(pending.length)} />
        <Kpi label="Amount awaiting" value={money(pendingTotal)} />
        <Kpi label="Recently verified" value={String(verified.length)} sub="last 30 days" />
      </div>

      <div className="flex gap-2">
        <Button
          variant={tab === "pending" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("pending")}
        >
          Awaiting ({pending.length})
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
            {tab === "pending" ? "Awaiting verification" : "Recently verified"}
          </CardTitle>
          <CardDescription>
            {tab === "pending"
              ? "Oldest first. Verify once the money is confirmed in the wallet."
              : "Flag back to unverified if a sign-off was a mistake."}
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
                      {p.isVerified ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy === p.id}
                          onClick={() => setVerified(p.id, false)}
                        >
                          Unflag
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busy === p.id}
                          onClick={() => setVerified(p.id, true)}
                        >
                          Verify
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
                      {tab === "pending"
                        ? "Nothing awaiting verification. 🎉"
                        : "No recently verified payments."}
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
