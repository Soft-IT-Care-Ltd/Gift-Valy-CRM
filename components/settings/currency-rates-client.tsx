"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import {
  formatInCurrency,
  rateLine,
  type CurrencyRateRow,
} from "@/lib/currency-constants";

// SPEC §5 — Admin-maintained rate table behind the customer-currency display
// on invoices. A customer's free-text country is matched (case-insensitively)
// against each currency's country list; the invoice then prints "≈" amounts
// at the stored rate. Display-only: order money stays BDT everywhere.

interface FormState {
  code: string;
  name: string;
  symbol: string;
  bdtPerUnit: string;
  countries: string; // comma-separated in the form
  isActive: boolean;
}

const EMPTY: FormState = {
  code: "",
  name: "",
  symbol: "",
  bdtPerUnit: "",
  countries: "",
  isActive: true,
};

function toForm(r: CurrencyRateRow): FormState {
  return {
    code: r.code,
    name: r.name,
    symbol: r.symbol ?? "",
    bdtPerUnit: String(r.bdtPerUnit),
    countries: r.countries.join(", "),
    isActive: r.isActive,
  };
}

export function CurrencyRatesClient({ initial }: { initial: CurrencyRateRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<CurrencyRateRow[]>(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CurrencyRateRow | null>(null);
  const [f, setF] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<FormState>) =>
    setF((prev) => ({ ...prev, ...patch }));

  function openCreate() {
    setEditing(null);
    setF(EMPTY);
    setOpen(true);
  }

  function openEdit(r: CurrencyRateRow) {
    setEditing(r);
    setF(toForm(r));
    setOpen(true);
  }

  const rate = Number(f.bdtPerUnit);
  const preview =
    f.code.trim() && rate > 0
      ? {
          code: f.code.trim().toUpperCase(),
          symbol: f.symbol.trim() || null,
          bdtPerUnit: rate,
        }
      : null;

  function payload() {
    return {
      code: f.code.trim().toUpperCase(),
      name: f.name.trim(),
      symbol: f.symbol.trim() || undefined,
      bdtPerUnit: rate,
      countries: f.countries
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      isActive: f.isActive,
    };
  }

  async function save() {
    if (!f.code.trim() || !f.name.trim()) {
      toast.error("Code and name are required");
      return;
    }
    if (!(rate > 0)) {
      toast.error("Enter the rate as ৳ per 1 unit (e.g. 32.5 for SAR)");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        editing ? `/api/settings/currencies/${editing.id}` : "/api/settings/currencies",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload()),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save");
      const saved = body as CurrencyRateRow;
      setRows((prev) =>
        editing
          ? prev.map((r) => (r.id === saved.id ? saved : r))
          : [...prev, saved].sort((a, b) => a.code.localeCompare(b.code))
      );
      toast.success(editing ? `${saved.code} updated` : `${saved.code} added`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(r: CurrencyRateRow, isActive: boolean) {
    const res = await fetch(`/api/settings/currencies/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not update");
      return;
    }
    setRows((prev) => prev.map((x) => (x.id === r.id ? (body as CurrencyRateRow) : x)));
  }

  async function remove(r: CurrencyRateRow) {
    if (!confirm(`Delete ${r.code}? Invoices will stop showing ${r.code} amounts.`))
      return;
    const res = await fetch(`/api/settings/currencies/${r.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Could not delete");
      return;
    }
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    toast.success(`${r.code} deleted`);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Currency rates</h1>
          <p className="text-sm text-muted-foreground">
            Customer-currency display on invoices (SPEC §5). When a customer&apos;s
            country matches a currency below, the invoice shows approximate
            amounts in that currency next to the BDT totals. Amounts stay BDT —
            this is display only.
          </p>
        </div>
        <Button onClick={openCreate}>Add currency</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rates</CardTitle>
          <CardDescription>
            Rate = how many taka one unit buys (1 SAR = ৳32.50 → enter 32.50).
            Update rates as often as needed; each invoice uses the rate at the
            moment it is generated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No currencies yet — add SAR, AED, USD… and list the customer
              countries each one applies to.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Currency</TableHead>
                  <TableHead className="text-right">৳ per 1 unit</TableHead>
                  <TableHead>Countries</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className={r.isActive ? "" : "opacity-60"}>
                    <TableCell>
                      <div className="font-medium">
                        {r.code}
                        {r.symbol ? (
                          <span className="ml-1 text-muted-foreground">
                            {r.symbol}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">{r.name}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {r.bdtPerUnit.toLocaleString("en-IN", {
                        maximumFractionDigits: 4,
                      })}
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-56 flex-wrap gap-1">
                        {r.countries.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            No countries — never shown
                          </span>
                        ) : (
                          r.countries.map((c) => (
                            <Badge key={c} variant="secondary">
                              {c}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={r.isActive}
                        onCheckedChange={(v) => toggleActive(r, v)}
                        aria-label={`Toggle ${r.code}`}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(r.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => openEdit(r)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => remove(r)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.code}` : "Add currency"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1">
                <Label className="text-xs">Code (ISO)</Label>
                <Input
                  value={f.code}
                  onChange={(e) => set({ code: e.target.value.toUpperCase() })}
                  placeholder="SAR"
                  maxLength={8}
                />
              </div>
              <div className="col-span-2 grid gap-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={f.name}
                  onChange={(e) => set({ name: e.target.value })}
                  placeholder="Saudi Riyal"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1">
                <Label className="text-xs">Symbol (optional)</Label>
                <Input
                  value={f.symbol}
                  onChange={(e) => set({ symbol: e.target.value })}
                  placeholder="﷼"
                  maxLength={8}
                />
              </div>
              <div className="col-span-2 grid gap-1">
                <Label className="text-xs">Rate — ৳ per 1 unit</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.0001"
                  value={f.bdtPerUnit}
                  onChange={(e) => set({ bdtPerUnit: e.target.value })}
                  placeholder="32.50"
                />
              </div>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Customer countries (comma-separated)</Label>
              <Input
                value={f.countries}
                onChange={(e) => set({ countries: e.target.value })}
                placeholder="Saudi Arabia, KSA"
              />
              <p className="text-xs text-muted-foreground">
                Must match the country written on the customer — add spelling
                variants (e.g. “UAE, United Arab Emirates”).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={f.isActive}
                onCheckedChange={(v) => set({ isActive: v })}
                id="currency-active"
              />
              <Label htmlFor="currency-active" className="text-sm">
                Active
              </Label>
            </div>
            {preview && (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                {rateLine(preview)} · ৳3,500 ≈ {formatInCurrency(3500, preview)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {editing ? "Save changes" : "Add currency"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
