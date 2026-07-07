"use client";

import { useMemo, useState } from "react";
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
  totalAmount: number;
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

export function PurchasesClient({
  purchases,
  products,
}: {
  purchases: PurchaseRow[];
  products: ProductOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayDhaka());
  const [paymentStatus, setPaymentStatus] =
    useState<PurchasePaymentStatusValue>("PAID");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { productId: "", qty: "", unitCost: "" },
  ]);
  const [saving, setSaving] = useState(false);

  const productById = useMemo(
    () => new Map(products.map((p) => [String(p.id), p])),
    [products]
  );

  const total = lines.reduce((s, l) => {
    const q = Number(l.qty);
    const c = Number(l.unitCost);
    return s + (q > 0 && c >= 0 ? q * c : 0);
  }, 0);

  function reset() {
    setSupplierName("");
    setPurchaseDate(todayDhaka());
    setPaymentStatus("PAID");
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

    setSaving(true);
    const res = await fetch("/api/purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierName: supplierName.trim(),
        purchaseDate,
        paymentStatus,
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
              Supplier purchases increase stock, update weighted-avg cost, and
              auto-create the expense record (SPEC §6.3).
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
                  <TableCell>
                    <Badge
                      variant={p.paymentStatus === "PAID" ? "secondary" : "destructive"}
                    >
                      {PURCHASE_PAYMENT_STATUS_LABELS[
                        p.paymentStatus as PurchasePaymentStatusValue
                      ] ?? p.paymentStatus}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {purchases.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No purchases recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
