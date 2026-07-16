"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateFilter } from "@/components/ui/date-filter";
import type { DateFilterPreset } from "@/lib/date-filter";
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
import { formatDateTime } from "@/lib/format";
import {
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  LOST_REASONS,
  LOST_REASON_LABELS,
  MANUAL_LEAD_STATUSES,
  leadIsOpen,
  type InterestedItem,
  type LeadRow,
  type LeadSourceValue,
  type LeadStatusValue,
} from "@/lib/lead-constants";
import { CUSTOMER_COUNTRIES } from "@/lib/order-constants";

// ---- option shapes passed from the server page ----
export interface CatalogPick {
  itemType: "PRODUCT" | "PACKAGE";
  id: number;
  name: string;
}
export interface UserPick {
  id: number;
  name: string;
}
export interface DuplicateHit {
  leads: LeadRow[];
  customer: { id: number; name: string; country: string; orderCount: number } | null;
}

const NONE = "__none__";

function dhakaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
}

// ISO → "YYYY-MM-DDTHH:mm" in Asia/Dhaka, for <input type=datetime-local>.
function isoToDhakaLocal(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}
function dhakaLocalToIso(local: string): string | null {
  if (!local) return null;
  return new Date(`${local}:00+06:00`).toISOString();
}

// ---- shared lead form state ----
interface LeadFormState {
  leadDate: string;
  source: string;
  campaignName: string;
  customerName: string;
  country: string;
  whatsappNumber: string;
  interestedIn: InterestedItem[];
  status: string;
  followUpLocal: string; // "YYYY-MM-DDTHH:mm"
  lostReason: string;
  notes: string;
}
function emptyLeadForm(): LeadFormState {
  return {
    leadDate: dhakaToday(),
    source: "",
    campaignName: "",
    customerName: "",
    country: "",
    whatsappNumber: "",
    interestedIn: [],
    status: "NEW",
    followUpLocal: "",
    lostReason: "",
    notes: "",
  };
}
function formToPayload(f: LeadFormState) {
  return {
    leadDate: f.leadDate,
    source: f.source as LeadSourceValue,
    campaignName: f.campaignName.trim() || null,
    customerName: f.customerName.trim() || null,
    country: f.country || null,
    whatsappNumber: f.whatsappNumber.trim(),
    interestedIn: f.interestedIn.map((i) => ({ itemType: i.itemType, id: i.id })),
    status: f.status,
    followUpAt: dhakaLocalToIso(f.followUpLocal),
    lostReason: f.status === "LOST" ? f.lostReason || null : null,
    notes: f.notes.trim() || null,
  };
}
function validateLeadForm(f: LeadFormState): string | null {
  if (!f.leadDate) return "Pick the lead date";
  if (!f.source) return "Pick a source";
  if (f.whatsappNumber.replace(/\D/g, "").length < 6) return "Enter a valid WhatsApp number";
  if (!f.status) return "Pick a status";
  if (f.status === "LOST" && !f.lostReason) return "A lost reason is required";
  return null;
}

export function LeadsClient({
  leads,
  todayCount,
  overdueLeadIds,
  catalog,
  assignableUsers,
  campaigns,
  canReassign,
  canConvert,
  me,
}: {
  leads: LeadRow[];
  todayCount: number;
  overdueLeadIds: number[];
  catalog: CatalogPick[];
  assignableUsers: UserPick[];
  campaigns: string[];
  canReassign: boolean;
  canConvert: boolean;
  me: UserPick;
}) {
  const router = useRouter();
  const overdueSet = useMemo(() => new Set(overdueLeadIds), [overdueLeadIds]);

  // ---- quick entry ----
  const [form, setForm] = useState<LeadFormState>(emptyLeadForm);
  const [saving, setSaving] = useState(false);
  const [dup, setDup] = useState<DuplicateHit | null>(null);
  const dupSeq = useRef(0);

  const checkDuplicate = useCallback(async (phone: string) => {
    const seq = ++dupSeq.current;
    if (phone.replace(/\D/g, "").length < 6) {
      setDup(null);
      return;
    }
    const res = await fetch(`/api/leads/check-duplicate?phone=${encodeURIComponent(phone)}`);
    if (!res.ok || seq !== dupSeq.current) return;
    const data: DuplicateHit = await res.json();
    setDup(data.leads.length > 0 || data.customer ? data : null);
  }, []);

  async function addLead() {
    const err = validateLeadForm(form);
    if (err) return toast.error(err);
    setSaving(true);
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formToPayload(form)),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      return toast.error(d?.error ?? "Failed to save lead");
    }
    toast.success("Lead saved");
    // Keep date + source for fast repeated entry; clear the rest.
    setForm((f) => ({ ...emptyLeadForm(), leadDate: f.leadDate, source: f.source }));
    setDup(null);
    router.refresh();
  }

  // ---- edit dialog ----
  const [editing, setEditing] = useState<LeadRow | null>(null);
  const [editForm, setEditForm] = useState<LeadFormState>(emptyLeadForm);
  const [editSaving, setEditSaving] = useState(false);
  function openEdit(l: LeadRow) {
    setEditing(l);
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

  // ---- bulk daily count ----
  const [dc, setDc] = useState({ date: dhakaToday(), source: "", campaignName: "", count: "" });
  const [dcSaving, setDcSaving] = useState(false);
  async function saveDailyCount() {
    if (!dc.source) return toast.error("Pick a source");
    const n = Number(dc.count);
    if (!Number.isInteger(n) || n < 0) return toast.error("Enter a valid count");
    setDcSaving(true);
    const res = await fetch("/api/lead-daily-counts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: dc.date,
        source: dc.source,
        campaignName: dc.campaignName.trim() || null,
        count: n,
      }),
    });
    setDcSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      return toast.error(d?.error ?? "Failed to save count");
    }
    toast.success("Daily count saved");
    setDc((s) => ({ ...s, count: "" }));
    router.refresh();
  }

  // ---- filters ----
  const [fStatus, setFStatus] = useState("ALL");
  const [fSource, setFSource] = useState("ALL");
  const [fSE, setFSE] = useState("ALL");
  const [q, setQ] = useState("");
  // Lead-date range — leadDate is YYYY-MM-DD, so string compare is safe.
  const [fRange, setFRange] = useState<{ preset: DateFilterPreset; from: string; to: string }>({
    preset: "all",
    from: "",
    to: "",
  });

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const digits = query.replace(/\D/g, "");
    return leads.filter((l) => {
      if (fStatus !== "ALL" && l.status !== fStatus) return false;
      if (fSource !== "ALL" && l.source !== fSource) return false;
      if (fSE !== "ALL" && String(l.assignedToId) !== fSE) return false;
      if (fRange.from && l.leadDate < fRange.from) return false;
      if (fRange.to && l.leadDate > fRange.to) return false;
      if (query) {
        const hay = `${l.customerName ?? ""} ${l.campaignName ?? ""}`.toLowerCase();
        const phoneHit = digits.length >= 3 && l.whatsappNumber.replace(/\D/g, "").includes(digits);
        if (!hay.includes(query) && !phoneHit) return false;
      }
      return true;
    });
  }, [leads, fStatus, fSource, fSE, fRange, q]);

  const showSEFilter = assignableUsers.length > 1 || canReassign;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Log every lead as it arrives (§3.1). Duplicate numbers are flagged with
            their history.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/leads/report">Lead report (R2)</Link>
        </Button>
      </div>

      {/* Follow-up reminder banner (§3.2) */}
      {(todayCount > 0 || overdueLeadIds.length > 0) && (
        <div className="flex flex-wrap gap-3">
          <div className="rounded-md border bg-background px-4 py-2 text-sm">
            <span className="font-semibold">Today&apos;s follow-ups:</span>{" "}
            {todayCount}
          </div>
          {overdueLeadIds.length > 0 && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              <span className="font-semibold">Overdue:</span> {overdueLeadIds.length}{" "}
              — follow up now
            </div>
          )}
        </div>
      )}

      {/* Quick entry (§3.1, <30s) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>New lead</CardTitle>
          <CardDescription>
            Date and source stay put after saving, so several in a row are fast.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <LeadFields
            f={form}
            set={(k, v) => setForm((s) => ({ ...s, [k]: v }))}
            catalog={catalog}
            campaigns={campaigns}
            onPhoneBlur={() => checkDuplicate(form.whatsappNumber)}
          />
          {dup && <DuplicateWarning dup={dup} />}
          <div className="flex justify-end">
            <Button onClick={addLead} disabled={saving}>
              {saving ? "Saving…" : "Save lead"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Bulk daily count (§3.1) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Bulk daily count</CardTitle>
          <CardDescription>
            Can&apos;t log each one? Record a per-source count for the day — used for
            conversion math when detailed leads are missing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="grid gap-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={dc.date} onChange={(e) => setDc((s) => ({ ...s, date: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Source</Label>
              <Select value={dc.source} onValueChange={(v) => setDc((s) => ({ ...s, source: v }))}>
                <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Campaign (optional)</Label>
              <Input
                list="lead-campaigns"
                placeholder="e.g. Eid FB Ad"
                value={dc.campaignName}
                onChange={(e) => setDc((s) => ({ ...s, campaignName: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Count</Label>
              <Input
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="25"
                value={dc.count}
                onChange={(e) => setDc((s) => ({ ...s, count: e.target.value }))}
              />
            </div>
            <Button variant="secondary" onClick={saveDailyCount} disabled={dcSaving}>
              {dcSaving ? "Saving…" : "Save count"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="grid gap-1">
            <Label className="text-xs">Search</Label>
            <Input
              placeholder="Name, phone or campaign"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-52"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Status</Label>
            <Select value={fStatus} onValueChange={setFStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {(["NEW", "CONTACTED", "FOLLOW_UP", "NEGOTIATING", "CONVERTED", "LOST"] as LeadStatusValue[]).map((s) => (
                  <SelectItem key={s} value={s}>{LEAD_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Source</Label>
            <Select value={fSource} onValueChange={setFSource}>
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
              <Select value={fSE} onValueChange={setFSE}>
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
            value={fRange.preset}
            from={fRange.from}
            to={fRange.to}
            onApply={(preset, from, to) => setFRange({ preset, from, to })}
          />
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Leads ({filtered.length})</CardTitle>
          <CardDescription>Overdue follow-ups are flagged red.</CardDescription>
        </CardHeader>
        <CardContent>
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
                {filtered.map((l) => {
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
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                      No leads match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Campaign autocomplete source */}
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
            set={(k, v) => setEditForm((s) => ({ ...s, [k]: v }))}
            catalog={catalog}
            campaigns={campaigns}
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

// ---- shared field grid (create + edit) ----
function LeadFields({
  f,
  set,
  catalog,
  campaigns,
  onPhoneBlur,
}: {
  f: LeadFormState;
  set: <K extends keyof LeadFormState>(k: K, v: LeadFormState[K]) => void;
  catalog: CatalogPick[];
  campaigns: string[];
  onPhoneBlur?: () => void;
}) {
  const addInterested = (val: string) => {
    if (val === NONE) return;
    const [itemType, idStr] = val.split(":");
    const id = Number(idStr);
    if (f.interestedIn.some((i) => i.itemType === itemType && i.id === id)) return;
    const pick = catalog.find((c) => c.itemType === itemType && c.id === id);
    if (pick) set("interestedIn", [...f.interestedIn, { itemType: pick.itemType, id: pick.id, name: pick.name }]);
  };
  const removeInterested = (it: InterestedItem) =>
    set("interestedIn", f.interestedIn.filter((i) => !(i.itemType === it.itemType && i.id === it.id)));

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5">
          <Label className="text-xs">Lead date</Label>
          <Input type="date" value={f.leadDate} onChange={(e) => set("leadDate", e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Source</Label>
          <Select value={f.source} onValueChange={(v) => set("source", v)}>
            <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
            <SelectContent>
              {LEAD_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Campaign (optional)</Label>
          <Input
            list="lead-campaigns"
            placeholder="e.g. Eid FB Ad"
            value={f.campaignName}
            onChange={(e) => set("campaignName", e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Status</Label>
          <Select value={f.status} onValueChange={(v) => set("status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MANUAL_LEAD_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{LEAD_STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5">
          <Label className="text-xs">Customer name (optional)</Label>
          <Input value={f.customerName} onChange={(e) => set("customerName", e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Country (optional)</Label>
          <Select value={f.country || NONE} onValueChange={(v) => set("country", v === NONE ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Country" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {CUSTOMER_COUNTRIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">WhatsApp number</Label>
          <Input
            placeholder="+966 5X XXX XXXX"
            value={f.whatsappNumber}
            onChange={(e) => set("whatsappNumber", e.target.value)}
            onBlur={onPhoneBlur}
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Follow-up (optional)</Label>
          <Input
            type="datetime-local"
            value={f.followUpLocal}
            onChange={(e) => set("followUpLocal", e.target.value)}
          />
        </div>
      </div>

      {f.status === "LOST" && (
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label className="text-xs">Lost reason</Label>
          <Select value={f.lostReason} onValueChange={(v) => set("lostReason", v)}>
            <SelectTrigger><SelectValue placeholder="Why lost?" /></SelectTrigger>
            <SelectContent>
              {LOST_REASONS.map((r) => (
                <SelectItem key={r} value={r}>{LOST_REASON_LABELS[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label className="text-xs">Interested in (optional)</Label>
        <div className="flex flex-wrap items-center gap-2">
          {f.interestedIn.map((it) => (
            <Badge key={`${it.itemType}-${it.id}`} variant="secondary" className="gap-1">
              {it.name}
              <button
                type="button"
                onClick={() => removeInterested(it)}
                className="ml-0.5 rounded-sm px-0.5 hover:bg-background/60"
                aria-label={`Remove ${it.name}`}
              >
                ×
              </button>
            </Badge>
          ))}
          <Select value={NONE} onValueChange={addInterested}>
            <SelectTrigger className="h-8 w-48"><SelectValue placeholder="+ Add item" /></SelectTrigger>
            <SelectContent>
              {catalog.map((c) => (
                <SelectItem key={`${c.itemType}-${c.id}`} value={`${c.itemType}:${c.id}`}>
                  {c.itemType === "PACKAGE" ? "📦 " : ""}
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label className="text-xs">Notes (optional)</Label>
        <Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>
    </div>
  );
}

function DuplicateWarning({ dup }: { dup: DuplicateHit }) {
  return (
    <div className="rounded-md border border-amber-400/60 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
      <div className="font-semibold text-amber-800 dark:text-amber-300">
        This number already exists — check the history before logging.
      </div>
      {dup.customer && (
        <div className="mt-1 text-amber-800 dark:text-amber-200">
          Existing customer: <span className="font-medium">{dup.customer.name}</span>{" "}
          ({dup.customer.country}) — {dup.customer.orderCount} order
          {dup.customer.orderCount === 1 ? "" : "s"} placed.
        </div>
      )}
      {dup.leads.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-amber-800 dark:text-amber-200">
          {dup.leads.map((l) => (
            <li key={l.id}>
              • {l.leadDate} · {LEAD_SOURCE_LABELS[l.source]} ·{" "}
              {LEAD_STATUS_LABELS[l.status]} · {l.assignedToName}
              {l.convertedOrder ? ` → ${l.convertedOrder.orderNo}` : ""}
            </li>
          ))}
        </ul>
      )}
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
    <Badge variant={variant} className="whitespace-nowrap">
      {LEAD_STATUS_LABELS[status]}
      {status === "LOST" && lostReason ? ` · ${LOST_REASON_LABELS[lostReason as keyof typeof LOST_REASON_LABELS]}` : ""}
    </Badge>
  );
}
