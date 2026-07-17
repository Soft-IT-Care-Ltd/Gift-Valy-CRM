"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { money, formatDate } from "@/lib/format";
import type { WalletOption } from "@/lib/wallet";
import type { PurchaseDues, PurchaseDueRow } from "@/lib/purchases";
import {
  PURCHASE_PAYMENT_STATUSES,
  PURCHASE_PAYMENT_STATUS_LABELS,
  type PurchasePaymentStatusValue,
} from "@/lib/stock-constants";

export interface ProductOption {
  id: number;
  sku: string;
  name: string;
  unit: string;
  avgCost: number;
  stockQty: number;
}

export interface PurchaseRow {
  id: number;
  supplierName: string;
  purchaseDate: string;
  dueDate: string | null;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  paymentStatus: string;
  notes: string | null;
  items: {
    sku: string;
    name: string;
    unit: string;
    qty: number;
    unitCost: number;
    lineTotal: number;
  }[];
}

interface DraftLine {
  productId: string;
  qty: string;
  unitCost: string;
}

const todayDhaka = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const round2 = (n: number) => Math.round(n * 100) / 100;

function PaymentBadge({ status }: { status: string }) {
  const label =
    PURCHASE_PAYMENT_STATUS_LABELS[status as PurchasePaymentStatusValue] ?? status;
  const variant =
    status === "PAID" ? "secondary" : status === "PARTIAL" ? "outline" : "destructive";
  return <Badge variant={variant}>{label}</Badge>;
}

export function PurchasesClient({
  purchases,
  products,
  wallets,
  dues,
}: {
  purchases: PurchaseRow[];
  products: ProductOption[];
  wallets: WalletOption[];
  dues: PurchaseDues;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayDhaka());
  const [paymentStatus, setPaymentStatus] =
    useState<PurchasePaymentStatusValue>("PAID");
  const [walletId, setWalletId] = useState("");
  const [partialAmount, setPartialAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { productId: "", qty: "", unitCost: "" },
  ]);
  const [saving, setSaving] = useState(false);

  const productById = useMemo(
    () => new Map(products.map((p) => [String(p.id), p])),
    [products]
  );

  // CORRECTIONS Stock/Purchase §1 — the Requirement Planner's "Pre-fill purchase
  // entry" hands a requisition over via sessionStorage: open the New Purchase
  // dialog pre-filled with the short products (qty = shortage, cost = estimate).
  // Consume it once so a later manual visit starts blank.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("gv_purchase_prefill");
      if (!raw) return;
      sessionStorage.removeItem("gv_purchase_prefill");
      const data = JSON.parse(raw) as {
        lines?: { productId: number; qty: number; unitCost: number }[];
        notes?: string;
      };
      if (!data.lines?.length) return;
      setLines(
        data.lines.map((l) => ({
          productId: String(l.productId),
          qty: String(l.qty),
          unitCost: String(l.unitCost),
        }))
      );
      if (data.notes) setNotes(data.notes);
      setOpen(true);
      toast.info("Pre-filled from the Requirement Planner — review and save.");
    } catch {
      /* malformed prefill — ignore */
    }
  }, []);

  const total = lines.reduce((s, l) => {
    const q = Number(l.qty);
    const c = Number(l.unitCost);
    return s + (q > 0 && c >= 0 ? q * c : 0);
  }, 0);

  // Cash paid now depends on the chosen status; the rest becomes a supplier due.
  const payingNow =
    paymentStatus === "PAID"
      ? total
      : paymentStatus === "PARTIAL"
        ? Math.min(Math.max(Number(partialAmount) || 0, 0), total)
        : 0;
  const remainingDue = round2(Math.max(total - payingNow, 0));
  const needsWallet = payingNow > 0;
  const needsDueDate = remainingDue > 0;

  function reset() {
    setSupplierName("");
    setPurchaseDate(todayDhaka());
    setPaymentStatus("PAID");
    setWalletId("");
    setPartialAmount("");
    setDueDate("");
    setNotes("");
    setLines([{ productId: "", qty: "", unitCost: "" }]);
  }

  function setLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  // Prefill unit cost with the current weighted-avg as a sensible starting point.
  function onPickProduct(i: number, productId: string) {
    const p = productById.get(productId);
    setLine(i, {
      productId,
      unitCost: lines[i].unitCost || (p ? String(p.avgCost) : ""),
    });
  }

  function addLine() {
    setLines((prev) => [...prev, { productId: "", qty: "", unitCost: "" }]);
  }

  function removeLine(i: number) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, j) => j !== i)));
  }

  async function save() {
    const items = lines
      .filter((l) => l.productId && Number(l.qty) > 0)
      .map((l) => ({
        productId: Number(l.productId),
        qty: Number(l.qty),
        unitCost: Number(l.unitCost),
      }));
    if (!supplierName.trim()) return toast.error("Supplier name is required");
    if (items.length === 0) return toast.error("Add at least one product line");
    const ids = new Set(items.map((i) => i.productId));
    if (ids.size !== items.length)
      return toast.error("Duplicate product — merge into one line");
    if (paymentStatus === "PARTIAL" && !(Number(partialAmount) > 0))
      return toast.error("Enter the amount you are paying now");
    if (paymentStatus === "PARTIAL" && payingNow >= total)
      return toast.error("Partial payment must be less than the total — use Paid instead");
    if (needsWallet && !walletId)
      return toast.error("Select the wallet the payment came from");
    if (needsDueDate && !dueDate)
      return toast.error("Set the date the remaining balance is due");

    setSaving(true);
    const res = await fetch("/api/purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierName: supplierName.trim(),
        purchaseDate,
        paidAmount: round2(payingNow),
        walletId: needsWallet ? Number(walletId) : null,
        dueDate: needsDueDate ? dueDate : null,
        notes: notes.trim() || null,
        items,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to save purchase");
      return;
    }
    toast.success("Purchase recorded — stock and avg cost updated");
    setOpen(false);
    reset();
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Purchases</CardTitle>
            <CardDescription>
              Supplier purchases increase stock and update weighted-avg cost. The
              cost is expensed as it is paid — a Due purchase posts no expense until
              you pay it down (SPEC §6.3).
            </CardDescription>
          </div>
          <Button
            onClick={() => {
              reset();
              setOpen(true);
            }}
          >
            New purchase
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead>Payment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchases.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(p.purchaseDate)}
                  </TableCell>
                  <TableCell className="font-medium">{p.supplierName}</TableCell>
                  <TableCell className="max-w-md text-sm text-muted-foreground">
                    {p.items
                      .map((it) => `${it.qty} × ${it.name} @ ${money(it.unitCost)}`)
                      .join(", ")}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {money(p.totalAmount)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {money(p.paidAmount)}
                  </TableCell>
                  <TableCell className="text-right">
                    {p.dueAmount > 0 ? (
                      <span className="font-medium text-destructive">
                        {money(p.dueAmount)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <PaymentBadge status={p.paymentStatus} />
                  </TableCell>
                </TableRow>
              ))}
              {purchases.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No purchases recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SupplierDues dues={dues} wallets={wallets} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>New purchase</DialogTitle>
            <DialogDescription>
              Only stock-tracked products appear here; perishables are costed per
              order.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-2 sm:col-span-1">
                <Label>Supplier</Label>
                <Input
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="Supplier name"
                />
              </div>
              <div className="grid gap-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Payment status</Label>
                <Select
                  value={paymentStatus}
                  onValueChange={(v) =>
                    setPaymentStatus(v as PurchasePaymentStatusValue)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PURCHASE_PAYMENT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {PURCHASE_PAYMENT_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Product lines</Label>
              <div className="space-y-2">
                {lines.map((line, i) => {
                  const p = productById.get(line.productId);
                  const lineTotal =
                    Number(line.qty) > 0 && Number(line.unitCost) >= 0
                      ? Number(line.qty) * Number(line.unitCost)
                      : 0;
                  return (
                    <div key={i} className="flex flex-wrap items-end gap-2">
                      <div className="grid min-w-52 flex-1 gap-1">
                        <Select
                          value={line.productId}
                          onValueChange={(v) => onPickProduct(i, v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select product" />
                          </SelectTrigger>
                          <SelectContent>
                            {products.map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.name} ({p.sku}) · {p.stockQty} on hand
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid w-24 gap-1">
                        <Input
                          type="number"
                          min={1}
                          placeholder="Qty"
                          value={line.qty}
                          onChange={(e) => setLine(i, { qty: e.target.value })}
                        />
                      </div>
                      <div className="grid w-28 gap-1">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="Unit cost"
                          value={line.unitCost}
                          onChange={(e) => setLine(i, { unitCost: e.target.value })}
                        />
                      </div>
                      <div className="w-24 pb-2 text-right text-sm text-muted-foreground">
                        {p ? money(lineTotal) : ""}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLine(i)}
                        disabled={lines.length === 1}
                      >
                        ✕
                      </Button>
                    </div>
                  );
                })}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                + Add line
              </Button>
            </div>

            {/* Payment details — conditional on the status (SPEC §6.3). */}
            <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
              {paymentStatus === "PARTIAL" && (
                <div className="grid gap-2">
                  <Label>Paying now</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Amount"
                    value={partialAmount}
                    onChange={(e) => setPartialAmount(e.target.value)}
                  />
                </div>
              )}
              {needsWallet && (
                <div className="grid gap-2">
                  <Label>Paid from wallet</Label>
                  <Select value={walletId} onValueChange={setWalletId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select wallet" />
                    </SelectTrigger>
                    <SelectContent>
                      {wallets.map((w) => (
                        <SelectItem key={w.id} value={String(w.id)}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {needsDueDate && (
                <div className="grid gap-2">
                  <Label>Balance due date</Label>
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              )}
              <div className="col-span-full flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                <span>
                  Paying now:{" "}
                  <span className="font-medium text-foreground">
                    {money(round2(payingNow))}
                  </span>
                </span>
                <span>
                  Remaining due:{" "}
                  <span
                    className={
                      remainingDue > 0
                        ? "font-medium text-destructive"
                        : "font-medium text-foreground"
                    }
                  >
                    {money(remainingDue)}
                  </span>
                </span>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Invoice number, delivery note, etc."
              />
            </div>

            <div className="flex items-center justify-between border-t pt-3 text-lg font-semibold">
              <span>Total</span>
              <span>{money(total)}</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Record purchase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Supplier dues (outstanding bills + pay action) ----------

function SupplierDues({
  dues,
  wallets,
}: {
  dues: PurchaseDues;
  wallets: WalletOption[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState<PurchaseDueRow | null>(null);
  const [amount, setAmount] = useState("");
  const [walletId, setWalletId] = useState("");
  const [payDate, setPayDate] = useState(todayDhaka());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  function openPay(row: PurchaseDueRow) {
    setTarget(row);
    setAmount(String(row.due));
    setWalletId("");
    setPayDate(todayDhaka());
    setNotes("");
  }

  async function pay() {
    if (!target) return;
    const amt = Number(amount);
    if (!(amt > 0)) return toast.error("Enter a payment amount");
    if (amt > target.due)
      return toast.error(`Amount exceeds the outstanding due of ${money(target.due)}`);
    if (!walletId) return toast.error("Select the wallet the payment came from");

    setSaving(true);
    const res = await fetch(`/api/purchases/${target.id}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amt,
        walletId: Number(walletId),
        paymentDate: payDate,
        notes: notes.trim() || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to record payment");
      return;
    }
    toast.success("Payment recorded — wallet and expense updated");
    setTarget(null);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Supplier dues</CardTitle>
            <CardDescription>
              Outstanding purchase bills. Paying one records the expense on the pay
              date and reduces the chosen wallet (SPEC §6.3 / §9.1).
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline">
              Outstanding: {money(dues.totalOutstanding)}
            </Badge>
            {dues.overdueCount > 0 && (
              <Badge variant="destructive">
                {dues.overdueCount} overdue · {money(dues.overdueTotal)}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead>
              <TableHead>Purchased</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Due</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dues.rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  {r.supplierName}
                  <div className="max-w-xs truncate text-xs text-muted-foreground">
                    {r.itemsSummary}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDate(r.purchaseDate)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {r.dueDate ? (
                    r.overdue ? (
                      <Badge variant="destructive">
                        {formatDate(r.dueDate)} · {r.ageDays}d overdue
                      </Badge>
                    ) : (
                      formatDate(r.dueDate)
                    )
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">{money(r.total)}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {money(r.paid)}
                </TableCell>
                <TableCell className="text-right font-medium text-destructive">
                  {money(r.due)}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => openPay(r)}>
                    Pay
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {dues.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No outstanding supplier dues. 🎉
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pay supplier due</DialogTitle>
            <DialogDescription>
              {target
                ? `${target.supplierName} · outstanding ${money(target.due)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Amount</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Pay the full due or enter a smaller amount for a partial payment.
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Paid from wallet</Label>
              <Select value={walletId} onValueChange={setWalletId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select wallet" />
                </SelectTrigger>
                <SelectContent>
                  {wallets.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Payment date</Label>
              <Input
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Notes (optional)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reference, cheque no., etc."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button onClick={pay} disabled={saving}>
              {saving ? "Saving…" : "Record payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
