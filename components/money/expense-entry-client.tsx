"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { money, formatDate } from "@/lib/format";
import { ReceiptField } from "@/components/money/receipt-field";
import {
  AD_COST_CATEGORY,
  COST_TYPE_LABELS,
  autoExpenseSource,
  type CategoryOption,
  type ExpenseRow,
} from "@/lib/expense-constants";
import type { WalletOption } from "@/lib/wallet";

const NO_WALLET = "none";

// Today in Asia/Dhaka as YYYY-MM-DD (office day, not the server's).
function dhakaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(
    new Date()
  );
}

interface FormState {
  expenseDate: string;
  categoryId: string;
  amount: string;
  walletId: string;
  campaignName: string;
  notes: string;
  receiptUrl: string;
}

function emptyForm(): FormState {
  return {
    expenseDate: dhakaToday(),
    categoryId: "",
    amount: "",
    walletId: NO_WALLET,
    campaignName: "",
    notes: "",
    receiptUrl: "",
  };
}

export function ExpenseEntryClient({
  categories,
  wallets,
  expenses,
  monthLabel,
}: {
  categories: CategoryOption[];
  wallets: WalletOption[];
  expenses: ExpenseRow[];
  monthLabel: string;
}) {
  const router = useRouter();

  // Quick-entry form (inline for <1-min entry).
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Edit dialog reuses the same fields (manual expenses only).
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);
  const [editSaving, setEditSaving] = useState(false);
  const setEdit = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setEditForm((f) => ({ ...f, [k]: v }));

  const isAdCost = (categoryId: string) =>
    categories.find((c) => c.id === Number(categoryId))?.name === AD_COST_CATEGORY;

  function payloadFrom(f: FormState) {
    return {
      expenseDate: f.expenseDate,
      categoryId: Number(f.categoryId),
      amount: Number(f.amount),
      walletId: f.walletId === NO_WALLET ? null : Number(f.walletId),
      campaignName: isAdCost(f.categoryId) ? f.campaignName.trim() || null : null,
      notes: f.notes.trim() || null,
      receiptUrl: f.receiptUrl || null,
    };
  }

  function validate(f: FormState): string | null {
    if (!f.expenseDate) return "Pick a date";
    if (!f.categoryId) return "Pick a category";
    const amt = Number(f.amount);
    if (!Number.isFinite(amt) || amt <= 0) return "Enter an amount greater than zero";
    return null;
  }

  async function add() {
    const err = validate(form);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadFrom(form)),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to record expense");
      return;
    }
    toast.success("Expense recorded");
    // Keep date + category for fast repeated entry; clear the rest.
    setForm((f) => ({
      ...emptyForm(),
      expenseDate: f.expenseDate,
      categoryId: f.categoryId,
    }));
    router.refresh();
  }

  function openEdit(e: ExpenseRow) {
    setEditing(e);
    setEditForm({
      expenseDate: e.expenseDate.slice(0, 10),
      categoryId: String(e.categoryId),
      amount: String(e.amount),
      walletId: e.walletId == null ? NO_WALLET : String(e.walletId),
      campaignName: e.campaignName ?? "",
      notes: e.notes ?? "",
      receiptUrl: e.receiptUrl ?? "",
    });
  }

  async function saveEdit() {
    if (!editing) return;
    const err = validate(editForm);
    if (err) {
      toast.error(err);
      return;
    }
    setEditSaving(true);
    const res = await fetch(`/api/expenses/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadFrom(editForm)),
    });
    setEditSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to update expense");
      return;
    }
    toast.success("Expense updated");
    setEditing(null);
    router.refresh();
  }

  async function remove(e: ExpenseRow) {
    if (!confirm(`Delete this ${money(e.amount)} expense?`)) return;
    const res = await fetch(`/api/expenses/${e.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to delete expense");
      return;
    }
    toast.success("Expense deleted");
    router.refresh();
  }

  const totals = useMemo(() => {
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const fixed = expenses
      .filter((e) => e.costType === "FIXED")
      .reduce((s, e) => s + e.amount, 0);
    const auto = expenses.filter((e) => e.isAuto).reduce((s, e) => s + e.amount, 0);
    return { total, fixed, variable: total - fixed, auto };
  }, [expenses]);

  const monthName = new Date(monthLabel).toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Daily expenses</h1>
          <p className="text-sm text-muted-foreground">
            Record today&apos;s ad cost and other costs in under a minute.
            Purchase and courier expenses post here automatically.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/money/expense-categories">Categories</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/reports/expenses">Expense report (R8)</Link>
          </Button>
        </div>
      </div>

      {/* Quick entry */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>New expense</CardTitle>
          <CardDescription>
            {categories.length === 0 ? (
              <>
                No categories yet —{" "}
                <Link href="/money/expense-categories" className="underline">
                  add one first
                </Link>
                .
              </>
            ) : (
              "Date and category stay put after saving, so several entries in a row are fast."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={form.expenseDate}
                onChange={(e) => set("expenseDate", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Category</Label>
              <Select
                value={form.categoryId}
                onValueChange={(v) => set("categoryId", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name} · {COST_TYPE_LABELS[c.costType]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Amount (৳)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Paid via (wallet)</Label>
              <Select value={form.walletId} onValueChange={(v) => set("walletId", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_WALLET}>Unassigned</SelectItem>
                  {wallets.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {isAdCost(form.categoryId) && (
              <div className="grid gap-1.5">
                <Label className="text-xs">Campaign (optional)</Label>
                <Input
                  placeholder="e.g. Eid FB Ad"
                  value={form.campaignName}
                  onChange={(e) => set("campaignName", e.target.value)}
                />
              </div>
            )}
            <div className="grid gap-1.5 sm:col-span-2">
              <Label className="text-xs">Notes (optional)</Label>
              <Input
                placeholder="Anything worth remembering"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Receipt (optional)</Label>
              <ReceiptField
                value={form.receiptUrl}
                onChange={(url) => set("receiptUrl", url)}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={add} disabled={saving || categories.length === 0}>
              {saving ? "Saving…" : "Add expense"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* This-month KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={`${monthName} total`} value={money(totals.total)} sub={`${expenses.length} entries`} />
        <Kpi label="Fixed" value={money(totals.fixed)} />
        <Kpi label="Variable" value={money(totals.variable)} />
        <Kpi label="Auto (purchase/courier)" value={money(totals.auto)} sub="read-only, linked" />
      </div>

      {/* This-month ledger */}
      <Card>
        <CardHeader>
          <CardTitle>This month ({expenses.length})</CardTitle>
          <CardDescription>
            All expenses filed this month, newest first. Auto-expenses from the
            purchase and courier modules are read-only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Wallet</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((e) => {
                  const source = autoExpenseSource(e.refTable);
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(e.expenseDate)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{e.categoryName}</span>
                          <Badge
                            variant={e.costType === "FIXED" ? "secondary" : "outline"}
                            className="text-[10px]"
                          >
                            {COST_TYPE_LABELS[e.costType]}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.walletName ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[16rem]">
                        {e.campaignName && (
                          <div className="text-xs">
                            <span className="text-muted-foreground">Campaign:</span>{" "}
                            {e.campaignName}
                          </div>
                        )}
                        {e.notes && (
                          <div className="truncate text-xs text-muted-foreground" title={e.notes}>
                            {e.notes}
                          </div>
                        )}
                        {e.receiptUrl && (
                          <a
                            href={e.receiptUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs underline"
                          >
                            View receipt
                          </a>
                        )}
                        {!e.campaignName && !e.notes && !e.receiptUrl && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {source ? (
                          source.href ? (
                            <Link href={source.href} className="text-xs underline">
                              <Badge variant="secondary">{source.label}</Badge>
                            </Link>
                          ) : (
                            <Badge variant="secondary">{source.label}</Badge>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">Manual</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {money(e.amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        {e.isAuto ? (
                          <span className="text-xs text-muted-foreground">
                            Read-only
                          </span>
                        ) : (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEdit(e)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => remove(e)}
                            >
                              Delete
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {expenses.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-6 text-center text-muted-foreground"
                    >
                      No expenses this month yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit dialog (manual expenses only) */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit expense</DialogTitle>
            <DialogDescription>
              Update the date, category, amount or attachments.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  value={editForm.expenseDate}
                  onChange={(e) => setEdit("expenseDate", e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Amount (৳)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.amount}
                  onChange={(e) => setEdit("amount", e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Category</Label>
                <Select
                  value={editForm.categoryId}
                  onValueChange={(v) => setEdit("categoryId", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name} · {COST_TYPE_LABELS[c.costType]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Paid via (wallet)</Label>
                <Select
                  value={editForm.walletId}
                  onValueChange={(v) => setEdit("walletId", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_WALLET}>Unassigned</SelectItem>
                    {wallets.map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {isAdCost(editForm.categoryId) && (
              <div className="grid gap-1.5">
                <Label className="text-xs">Campaign (optional)</Label>
                <Input
                  value={editForm.campaignName}
                  onChange={(e) => setEdit("campaignName", e.target.value)}
                />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                rows={2}
                value={editForm.notes}
                onChange={(e) => setEdit("notes", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Receipt (optional)</Label>
              <ReceiptField
                value={editForm.receiptUrl}
                onChange={(url) => setEdit("receiptUrl", url)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save"}
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
