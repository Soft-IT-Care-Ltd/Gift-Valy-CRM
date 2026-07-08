"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { money } from "@/lib/format";
import {
  WALLET_TYPES,
  WALLET_TYPE_LABELS,
  type WalletRow,
  type WalletTypeValue,
} from "@/lib/wallet";
import type { WalletBalances } from "@/lib/reports";

export function WalletsClient({
  wallets,
  balances,
}: {
  wallets: WalletRow[];
  balances: WalletBalances;
}) {
  const router = useRouter();
  const balanceByWallet = new Map(balances.rows.map((r) => [r.walletId, r]));

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WalletRow | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [type, setType] = useState<WalletTypeValue>("BKASH");
  const [accountNo, setAccountNo] = useState("");
  const [isActive, setIsActive] = useState(true);

  function openCreate() {
    setEditing(null);
    setName("");
    setType("BKASH");
    setAccountNo("");
    setIsActive(true);
    setDialogOpen(true);
  }

  function openEdit(w: WalletRow) {
    setEditing(w);
    setName(w.name);
    setType(w.type);
    setAccountNo(w.accountNo ?? "");
    setIsActive(w.isActive);
    setDialogOpen(true);
  }

  async function save() {
    setSaving(true);
    const payload = {
      name,
      type,
      accountNo: accountNo.trim() || null,
      isActive,
    };
    const res = await fetch(
      editing ? `/api/wallets/${editing.id}` : "/api/wallets",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to save wallet");
      return;
    }
    toast.success(editing ? "Wallet updated" : "Wallet created");
    setDialogOpen(false);
    router.refresh();
  }

  async function remove(w: WalletRow) {
    if (!confirm(`Delete wallet "${w.name}"?`)) return;
    const res = await fetch(`/api/wallets/${w.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to delete wallet");
      return;
    }
    toast.success("Wallet deleted");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Wallets</h1>
          <p className="text-sm text-muted-foreground">
            Company accounts that receive payments and pay expenses. Balance =
            collections in − refunds/expenses out.
          </p>
        </div>
        <Button onClick={openCreate}>New wallet</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi label="Total wallet balance" value={money(balances.totalBalance)} />
        <Kpi label="Active wallets" value={String(wallets.filter((w) => w.isActive).length)} />
        <Kpi
          label="Unassigned collected"
          value={money(balances.unassignedCollected)}
          sub="COD not yet posted to a wallet"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>
            Running balance per wallet (SPEC §9.3). Deactivate a wallet to retire
            it while keeping its history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Account no.</TableHead>
                  <TableHead className="text-right">Collections in</TableHead>
                  <TableHead className="text-right">Out (refunds+exp.)</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wallets.map((w) => {
                  const bal = balanceByWallet.get(w.id);
                  const out =
                    (bal?.refundsOut ?? 0) + (bal?.expensesOut ?? 0);
                  return (
                    <TableRow
                      key={w.id}
                      className={!w.isActive ? "opacity-60" : undefined}
                    >
                      <TableCell className="font-medium">{w.name}</TableCell>
                      <TableCell>{WALLET_TYPE_LABELS[w.type]}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {w.accountNo ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {money(bal?.collectionsIn ?? 0)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {money(out)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {money(bal?.balance ?? 0)}
                      </TableCell>
                      <TableCell>
                        {w.isActive ? (
                          <Badge variant="secondary">Active</Badge>
                        ) : (
                          <Badge variant="outline">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(w)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => remove(w)}
                            disabled={w.paymentCount > 0 || w.expenseCount > 0}
                            title={
                              w.paymentCount > 0 || w.expenseCount > 0
                                ? "Has money history — deactivate instead"
                                : undefined
                            }
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {wallets.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-6 text-center text-muted-foreground"
                    >
                      No wallets yet. Add your company bKash/Nagad/Bank/Cash
                      accounts.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.name}` : "New wallet"}
            </DialogTitle>
            <DialogDescription>
              Name it clearly (e.g. “bKash — 01700xxxxxx”) so it is easy to pick
              when recording a payment.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as WalletTypeValue)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WALLET_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {WALLET_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Account / number (optional)</Label>
                <Input
                  value={accountNo}
                  onChange={(e) => setAccountNo(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label>Active</Label>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Save"}
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
