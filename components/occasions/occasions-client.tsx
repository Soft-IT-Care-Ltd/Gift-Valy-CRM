"use client";

// CORRECTIONS Orders §7 (C8) — the Occasions menu: upcoming birthdays /
// anniversaries with the period filter, a per-row WhatsApp "Follow up" pitch for
// the SE, and (for order-creating roles) inline add/edit of occasion dates so
// they're manageable outside the order form.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { cn } from "@/lib/utils";
import { money, formatDate } from "@/lib/format";
import { RECIPIENT_RELATIONS } from "@/lib/order-constants";
import {
  daysRemainingLabel,
  fmtDayMonth,
  occasionFollowUpText,
  type OccasionPeriod,
  type OccasionRow,
} from "@/lib/occasion-constants";
import { OccasionPeriodFilter } from "./occasion-period-filter";

function waHref(phoneForeign: string, text: string): string {
  return `https://wa.me/${phoneForeign.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

function DaysBadge({ days }: { days: number }) {
  const urgent = days <= 1;
  const soon = days <= 7;
  return (
    <Badge
      variant="outline"
      className={cn(
        urgent
          ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
          : soon
            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
            : "text-muted-foreground"
      )}
    >
      {daysRemainingLabel(days)}
    </Badge>
  );
}

// ---------- edit dialog ----------

function EditOccasionDialog({
  row,
  onClose,
  onSaved,
}: {
  row: OccasionRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [recipientName, setRecipientName] = useState(row.recipientName);
  const [relation, setRelation] = useState(row.relation ?? "");
  // Both dates are editable regardless of which one opened the row.
  const [birthday, setBirthday] = useState(
    row.type === "Birthday" ? row.date : ""
  );
  const [anniversary, setAnniversary] = useState(
    row.type === "Anniversary" ? row.date : ""
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/occasions/${row.occasionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientName: recipientName.trim(),
          relation: relation || null,
          birthday: birthday || null,
          anniversary: anniversary || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save");
      toast.success("Occasion updated");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit occasion</DialogTitle>
          <DialogDescription>
            {row.customerName} · {row.recipientPhoneBd}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label>Recipient name</Label>
            <Input
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label>Relation</Label>
            <Select value={relation} onValueChange={setRelation}>
              <SelectTrigger>
                <SelectValue placeholder="Relation" />
              </SelectTrigger>
              <SelectContent>
                {RECIPIENT_RELATIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>Birthday</Label>
              <Input
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label>Anniversary</Label>
              <Input
                type="date"
                value={anniversary}
                onChange={(e) => setAnniversary(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Clear a date field to remove that occasion. Saved to the customer&apos;s
            recipient profile — future orders prefill from it.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !recipientName.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- add dialog ----------

interface FoundCustomer {
  id: number;
  name: string;
  phoneForeign: string;
  country: string;
  orderCount: number;
}

function AddOccasionDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [searching, setSearching] = useState(false);
  const [customer, setCustomer] = useState<FoundCustomer | null>(null);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [relation, setRelation] = useState("");
  const [birthday, setBirthday] = useState("");
  const [anniversary, setAnniversary] = useState("");
  const [busy, setBusy] = useState(false);

  async function search() {
    setSearching(true);
    setCustomer(null);
    try {
      const res = await fetch(
        `/api/customers/search?phone=${encodeURIComponent(phone)}`
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Search failed");
      if (!body.customer) {
        toast.error("No customer found with that number — create an order first.");
        return;
      }
      setCustomer(body.customer as FoundCustomer);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function save() {
    if (!customer) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/occasions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          recipientName: recipientName.trim(),
          recipientPhoneBd: recipientPhone.trim(),
          relation: relation || null,
          birthday: birthday || null,
          anniversary: anniversary || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save");
      toast.success("Occasion added");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const canSave =
    !!customer &&
    !!recipientName.trim() &&
    !!recipientPhone.trim() &&
    (!!birthday || !!anniversary);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add occasion</DialogTitle>
          <DialogDescription>
            Look up an existing customer by their (foreign) phone number, then
            save a recipient birthday / anniversary.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label>Customer phone (foreign)</Label>
            <div className="flex gap-2">
              <Input
                value={phone}
                placeholder="+8801… or +9665…"
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && search()}
              />
              <Button
                variant="outline"
                onClick={search}
                disabled={searching || phone.replace(/\D/g, "").length < 6}
              >
                {searching ? "…" : "Find"}
              </Button>
            </div>
          </div>

          {customer && (
            <>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="font-medium">{customer.name}</span>{" "}
                <span className="text-muted-foreground">
                  · {customer.phoneForeign} · {customer.country} ·{" "}
                  {customer.orderCount} order
                  {customer.orderCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <Label>Recipient name</Label>
                  <Input
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label>Recipient phone (BD)</Label>
                  <Input
                    value={recipientPhone}
                    placeholder="01…"
                    onChange={(e) => setRecipientPhone(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-1">
                <Label>Relation</Label>
                <Select value={relation} onValueChange={setRelation}>
                  <SelectTrigger>
                    <SelectValue placeholder="Relation" />
                  </SelectTrigger>
                  <SelectContent>
                    {RECIPIENT_RELATIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <Label>Birthday</Label>
                  <Input
                    type="date"
                    value={birthday}
                    onChange={(e) => setBirthday(e.target.value)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label>Anniversary</Label>
                  <Input
                    type="date"
                    value={anniversary}
                    onChange={(e) => setAnniversary(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Enter at least one date. A recipient already saved for this
                customer is updated in place.
              </p>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !canSave}>
            {busy ? "Saving…" : "Save occasion"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- list ----------

export function OccasionsClient({
  rows,
  period,
  from,
  to,
  canManage,
  leadDays,
}: {
  rows: OccasionRow[];
  period: OccasionPeriod;
  from: string;
  to: string;
  canManage: boolean;
  leadDays: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<OccasionRow | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = () => {
    setEditing(null);
    setAdding(false);
    router.refresh();
  };

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Occasions</CardTitle>
              <CardDescription>
                Upcoming recipient birthdays &amp; anniversaries — pitch the
                repeat sale before the day. Reminders start {leadDays} day
                {leadDays === 1 ? "" : "s"} ahead on the dashboard.
              </CardDescription>
            </div>
            {canManage && (
              <Button onClick={() => setAdding(true)}>+ Add occasion</Button>
            )}
          </div>
          <OccasionPeriodFilter period={period} from={from} to={to} />
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No occasions in this period.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Relation</TableHead>
                  <TableHead>Occasion</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Last order</TableHead>
                  <TableHead className="text-right">Follow up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.occasionId}-${r.type}`}>
                    <TableCell>
                      <div className="font-medium">{r.customerName}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {r.customerPhone}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.country}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{r.recipientName}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {r.recipientPhoneBd}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.relation ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          r.type === "Birthday"
                            ? "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
                            : "bg-pink-100 text-pink-800 dark:bg-pink-950/40 dark:text-pink-300"
                        }
                      >
                        {r.type === "Birthday" ? "🎂 Birthday" : "💍 Anniversary"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">
                          {fmtDayMonth(r.nextOccurrence)}
                        </span>
                        <DaysBadge days={r.daysRemaining} />
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.lastOrder ? (
                        <>
                          <Link
                            href={`/orders/${r.lastOrder.id}`}
                            className="font-mono text-xs underline-offset-2 hover:underline"
                          >
                            {r.lastOrder.orderNo}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {formatDate(r.lastOrder.date)} ·{" "}
                            {money(r.lastOrder.total)}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="outline" asChild>
                          <a
                            href={waHref(
                              r.customerPhone,
                              occasionFollowUpText({
                                customerName: r.customerName,
                                recipientName: r.recipientName,
                                type: r.type,
                                nextOccurrence: r.nextOccurrence,
                              })
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Follow up
                          </a>
                        </Button>
                        {canManage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(r)}
                          >
                            Edit
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing && (
        <EditOccasionDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      {adding && (
        <AddOccasionDialog onClose={() => setAdding(false)} onSaved={refresh} />
      )}
    </div>
  );
}
