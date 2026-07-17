"use client";

// Leads landing page (CORRECTIONS Leads §7) — the LIST, restructured like
// Orders: entry moved to /leads/new (and /leads/bulk for leads.bulk holders),
// filters and pagination are URL-driven so the server only loads one page.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateFilter } from "@/components/ui/date-filter";
import { detectPreset } from "@/lib/date-filter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { formatDateTime } from "@/lib/format";
import {
  LEAD_PAGE_SIZES,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  LOST_REASON_LABELS,
  leadIsOpen,
  type LeadRow,
  type LeadStatusValue,
} from "@/lib/lead-constants";
import type { CommittedLeadRow } from "@/lib/leads";
import {
  LeadFields,
  applyFieldChange,
  emptyLeadForm,
  formToPayload,
  isoToDhakaLocal,
  validateLeadForm,
  type CatalogPick,
  type LeadFormState,
  type LeadFormTouched,
  type UserPick,
} from "@/components/leads/lead-form";

export type { CatalogPick, UserPick } from "@/components/leads/lead-form";

export function LeadsListClient({
  leads,
  committed,
  todayCount,
  overdueCount,
  overdueLeadIds,
  bulkCount,
  total,
  page,
  size,
  q,
  rangeAll,
  catalog,
  assignableUsers,
  campaigns,
  canCreate,
  canBulk,
  canReassign,
  canConvert,
  me,
}: {
  leads: LeadRow[]; // current page only
  committed: CommittedLeadRow[]; // Committed queue (CORRECTIONS Leads §9), oldest first
  todayCount: number;
  overdueCount: number;
  overdueLeadIds: number[]; // overdue rows on this page — flagged red
  bulkCount: number; // Σ lead_daily_counts in the current window (§6)
  total: number; // detailed leads matching the filters — drives pagination
  page: number;
  size: number;
  q: string;
  rangeAll: boolean;
  catalog: CatalogPick[];
  assignableUsers: UserPick[];
  campaigns: string[];
  canCreate: boolean; // leads.create — New Lead button
  canBulk: boolean; // leads.bulk — Bulk Lead button (§7)
  canReassign: boolean;
  canConvert: boolean;
  me: UserPick;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const overdueSet = useMemo(() => new Set(overdueLeadIds), [overdueLeadIds]);

  // Any filter change restarts at page 1 — a page number only means something
  // within the result set it was computed for.
  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value && value !== "ALL") next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    router.push(`/leads?${next.toString()}`);
  }

  // Debounced search — name, phone or campaign; spans all time.
  const [search, setSearch] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim() !== q) setParam("q", search.trim());
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // ---- edit dialog ----
  const [editing, setEditing] = useState<LeadRow | null>(null);
  const [editForm, setEditForm] = useState<LeadFormState>(emptyLeadForm);
  const editTouched = useRef<LeadFormTouched>({ country: true, followUp: true });
  const [editSaving, setEditSaving] = useState(false);
  function openEdit(l: LeadRow) {
    setEditing(l);
    // An existing lead's country / follow-up are deliberate — only re-detect
    // the country if the phone number itself is retyped.
    editTouched.current = { country: false, followUp: true };
    setEditForm({
      leadDate: l.leadDate,
      source: l.source,
      campaignName: l.campaignName ?? "",
      customerName: l.customerName ?? "",
      country: l.country ?? "",
      whatsappNumber: l.whatsappNumber,
      interestedIn: l.interestedIn,
      status: l.status,
      followUpLocal: l.followUpAt ? isoToDhakaLocal(l.followUpAt) : "",
      lostReason: l.lostReason ?? "",
      notes: l.notes ?? "",
    });
  }
  async function saveEdit() {
    if (!editing) return;
    const err = validateLeadForm(editForm);
    if (err) return toast.error(err);
    setEditSaving(true);
    const res = await fetch(`/api/leads/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formToPayload(editForm)),
    });
    setEditSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      return toast.error(d?.error ?? "Failed to update lead");
    }
    toast.success("Lead updated");
    setEditing(null);
    router.refresh();
  }

  // ---- reassign dialog ----
  const [reassigning, setReassigning] = useState<LeadRow | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [reassignSaving, setReassignSaving] = useState(false);
  async function saveReassign() {
    if (!reassigning || !reassignTo) return;
    setReassignSaving(true);
    const res = await fetch(`/api/leads/${reassigning.id}/reassign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedTo: Number(reassignTo) }),
    });
    setReassignSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      return toast.error(d?.error ?? "Failed to reassign");
    }
    toast.success("Lead reassigned");
    setReassigning(null);
    setReassignTo("");
    router.refresh();
  }

  const showSEFilter = assignableUsers.length > 1 || canReassign;
  const hasExplicitDates = !!params.get("from") || !!params.get("to");
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  const lastPage = Math.max(1, Math.ceil(total / size));

  const windowText = q
    ? "matching your search (all time)"
    : rangeAll || hasExplicitDates
      ? "in the selected range"
      : "this month";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Every lead in your scope (§3). Overdue follow-ups are flagged red.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/leads/report">Lead report (R2)</Link>
          </Button>
          {canBulk && (
            <Button variant="outline" asChild>
              <Link href="/leads/bulk">Bulk Lead</Link>
            </Button>
          )}
          {canCreate && (
            <Button asChild>
              <Link href="/leads/new">New Lead</Link>
            </Button>
          )}
        </div>
      </div>

      {/* Follow-up notices (§3.2) — informational alerts, not buttons
          (CORRECTIONS Leads §5): info style for today, warning for overdue. */}
      {(todayCount > 0 || overdueCount > 0) && (
        <div className="grid gap-2">
          {todayCount > 0 && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md border-l-4 border-sky-500 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
            >
              <InfoIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                <span className="font-semibold">
                  Today&apos;s follow-ups: {todayCount}
                </span>{" "}
                — scheduled for a call today.
              </span>
            </div>
          )}
          {overdueCount > 0 && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                <span className="font-semibold">Overdue: {overdueCount}</span>{" "}
                — follow-ups past their date. Follow up now.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Committed queue (CORRECTIONS Leads §9) — promised the advance, hasn't
          paid. Chase these until the payment lands / the draft confirms. */}
      {committed.length > 0 && (
        <Card className="border-amber-400/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              💰 Committed — awaiting payment ({committed.length})
            </CardTitle>
            <CardDescription>
              These customers confirmed the order and promised the advance.
              Follow up until the payment lands.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {committed.map((l) => (
              <div
                key={l.id}
                className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span className="font-medium">
                  {l.customerName ?? l.whatsappNumber}
                </span>
                <span className="text-xs text-muted-foreground">
                  {l.whatsappNumber}
                  {l.country ? ` · ${l.country}` : ""} · {l.assignedToName}
                </span>
                <Badge
                  variant={l.chaseOverdue ? "destructive" : "secondary"}
                  className="ml-auto whitespace-nowrap"
                >
                  committed {l.committedSince} ago
                </Badge>
                {l.convertedOrder ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/orders/${l.convertedOrder.id}`}>
                      {l.convertedOrder.orderNo}
                    </Link>
                  </Button>
                ) : (
                  canConvert && (
                    <Button size="sm" asChild>
                      <Link href={`/orders/new?leadId=${l.id}`}>
                        Take order
                      </Link>
                    </Button>
                  )
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* List + URL-driven filters (§4) */}
      <Card>
        <CardHeader>
          <CardTitle>Leads ({total})</CardTitle>
          <CardDescription>
            {total} detailed lead{total === 1 ? "" : "s"} {windowText}
            {bulkCount > 0 &&
              ` · +${bulkCount} logged in bulk = ${total + bulkCount} total`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label className="text-xs">Search</Label>
              <Input
                placeholder="Name, phone or campaign"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-52"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Status</Label>
              <Select
                value={params.get("status") ?? "ALL"}
                onValueChange={(v) => setParam("status", v)}
              >
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  {LEAD_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{LEAD_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Source</Label>
              <Select
                value={params.get("source") ?? "ALL"}
                onValueChange={(v) => setParam("source", v)}
              >
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All sources</SelectItem>
                  {LEAD_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {showSEFilter && (
              <div className="grid gap-1">
                <Label className="text-xs">Assigned SE</Label>
                <Select
                  value={params.get("seId") ?? "ALL"}
                  onValueChange={(v) => setParam("seId", v)}
                >
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Everyone</SelectItem>
                    {assignableUsers.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <DateFilter
              showAllTime
              value={
                rangeAll
                  ? "all"
                  : detectPreset(
                      params.get("from") ?? "",
                      params.get("to") ?? "",
                      "month" // list defaults to this month when no dates set
                    )
              }
              from={params.get("from") ?? ""}
              to={params.get("to") ?? ""}
              onApply={(preset, fromDate, toDate) => {
                const next = new URLSearchParams(params.toString());
                next.delete("page");
                if (preset === "all") {
                  next.set("range", "all");
                  next.delete("from");
                  next.delete("to");
                } else {
                  next.delete("range");
                  if (fromDate) next.set("from", fromDate);
                  else next.delete("from");
                  if (toDate) next.set("to", toDate);
                  else next.delete("to");
                }
                router.push(`/leads?${next.toString()}`);
              }}
            />
            {(params.get("status") ||
              params.get("source") ||
              params.get("seId") ||
              params.get("from") ||
              params.get("to") ||
              params.get("q") ||
              params.get("range") ||
              params.get("page")) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  router.push("/leads");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Source / Campaign</TableHead>
                  <TableHead>Interested</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Follow-up</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l) => {
                  const overdue = overdueSet.has(l.id);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {l.leadDate}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{l.customerName ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {l.whatsappNumber}
                          {l.country ? ` · ${l.country}` : ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>{LEAD_SOURCE_LABELS[l.source]}</div>
                        {l.campaignName && (
                          <div className="text-xs text-muted-foreground">{l.campaignName}</div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[12rem]">
                        {l.interestedIn.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {l.interestedIn.slice(0, 3).map((it) => (
                              <Badge key={`${it.itemType}-${it.id}`} variant="outline" className="text-[10px]">
                                {it.name}
                              </Badge>
                            ))}
                            {l.interestedIn.length > 3 && (
                              <span className="text-xs text-muted-foreground">
                                +{l.interestedIn.length - 3}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <LeadStatusBadge status={l.status} lostReason={l.lostReason} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {l.followUpAt ? (
                          <span className={overdue ? "font-medium text-destructive" : ""}>
                            {formatDateTime(l.followUpAt)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{l.assignedToName}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {l.convertedOrder ? (
                            <Button variant="outline" size="sm" asChild>
                              <Link href={`/orders/${l.convertedOrder.id}`}>
                                {l.convertedOrder.orderNo}
                              </Link>
                            </Button>
                          ) : (
                            <>
                              <Button variant="outline" size="sm" onClick={() => openEdit(l)}>
                                Edit
                              </Button>
                              {canConvert && leadIsOpen(l.status) && (
                                <Button size="sm" asChild>
                                  <Link href={`/orders/new?leadId=${l.id}`}>Convert</Link>
                                </Button>
                              )}
                              {canReassign && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setReassigning(l);
                                    setReassignTo("");
                                  }}
                                >
                                  Reassign
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {leads.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                      No leads match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination — page-size selector (25/50/100) + page nav (§4) */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm text-muted-foreground">
            <span>
              {total === 0 ? "No leads" : `Showing ${from}–${to} of ${total}`}
            </span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span>Rows</span>
                <Select value={String(size)} onValueChange={(v) => setParam("size", v)}>
                  <SelectTrigger className="h-8 w-[4.5rem]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEAD_PAGE_SIZES.map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {lastPage > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setParam("page", String(page - 1))}
                  >
                    ← Prev
                  </Button>
                  <span>
                    Page {page} of {lastPage}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= lastPage}
                    onClick={() => setParam("page", String(page + 1))}
                  >
                    Next →
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Campaign autocomplete source (edit dialog) */}
      <datalist id="lead-campaigns">
        {campaigns.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {/* Edit dialog */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit lead</DialogTitle>
            <DialogDescription>
              Update status, follow-up, interested items or details.
            </DialogDescription>
          </DialogHeader>
          <LeadFields
            f={editForm}
            set={(k, v) => setEditForm((s) => applyFieldChange(s, k, v, editTouched.current))}
            catalog={catalog}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reassign dialog */}
      <Dialog open={reassigning !== null} onOpenChange={(o) => !o && setReassigning(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reassign lead</DialogTitle>
            <DialogDescription>
              Move this lead to another SE — currently {reassigning?.assignedToName}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label className="text-xs">Assign to</Label>
            <Select value={reassignTo} onValueChange={setReassignTo}>
              <SelectTrigger><SelectValue placeholder="Pick an SE" /></SelectTrigger>
              <SelectContent>
                {assignableUsers
                  .filter((u) => u.id !== reassigning?.assignedToId)
                  .map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassigning(null)}>Cancel</Button>
            <Button onClick={saveReassign} disabled={reassignSaving || !reassignTo}>
              {reassignSaving ? "Saving…" : "Reassign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-xs text-muted-foreground">
        Signed in as {me.name}. New leads are assigned to you unless reassigned.
      </p>
    </div>
  );
}

export function LeadStatusBadge({
  status,
  lostReason,
}: {
  status: LeadStatusValue;
  lostReason?: string | null;
}) {
  const variant =
    status === "CONVERTED"
      ? "default"
      : status === "LOST"
        ? "destructive"
        : status === "NEGOTIATING"
          ? "secondary"
          : "outline";
  return (
    <Badge
      variant={variant}
      className={
        status === "COMMITTED"
          ? "whitespace-nowrap border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
          : "whitespace-nowrap"
      }
    >
      {status === "COMMITTED" ? "💰 " : ""}
      {LEAD_STATUS_LABELS[status]}
      {status === "LOST" && lostReason ? ` · ${LOST_REASON_LABELS[lostReason as keyof typeof LOST_REASON_LABELS]}` : ""}
    </Badge>
  );
}
