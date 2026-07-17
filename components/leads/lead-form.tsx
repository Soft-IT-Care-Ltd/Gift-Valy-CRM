"use client";

// Shared lead form bits — used by the New Lead page (entry) and the list's
// edit dialog. Field order per CORRECTIONS Leads §1: WhatsApp number FIRST,
// then Country (auto-detected from the dialing code, §2).

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  LOST_REASONS,
  LOST_REASON_LABELS,
  MANUAL_LEAD_STATUSES,
  detectCountryFromPhone,
  type InterestedItem,
  type LeadRow,
  type LeadSourceValue,
} from "@/lib/lead-constants";
import { CUSTOMER_COUNTRIES } from "@/lib/order-constants";

// ---- option shapes passed from the server pages ----
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

// ---- Dhaka-calendar date helpers for the form fields ----

export function dhakaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
}

function dhakaNowHm(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g("hour")}:${g("minute")}`;
}

// Day offset at fixed UTC noon — can't cross a date line.
function plusDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

// Default follow-up = entry date + 1 day, same time of day (§3 — editable).
export function defaultFollowUpLocal(leadDate: string): string {
  return `${plusDays(leadDate, 1)}T${dhakaNowHm()}`;
}

// ISO → "YYYY-MM-DDTHH:mm" in Asia/Dhaka, for <input type=datetime-local>.
export function isoToDhakaLocal(iso: string): string {
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
export function dhakaLocalToIso(local: string): string | null {
  if (!local) return null;
  return new Date(`${local}:00+06:00`).toISOString();
}

// ---- shared lead form state ----

export interface LeadFormState {
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

// Entry defaults (CORRECTIONS Leads §3, all editable): Status New,
// Country KSA, Source WhatsApp, follow-up = entry date + 1 day.
export function emptyLeadForm(): LeadFormState {
  const today = dhakaToday();
  return {
    leadDate: today,
    source: "WHATSAPP",
    campaignName: "",
    customerName: "",
    country: "KSA",
    whatsappNumber: "",
    interestedIn: [],
    status: "NEW",
    followUpLocal: defaultFollowUpLocal(today),
    lostReason: "",
    notes: "",
  };
}

// Which convenience fields the user has overridden by hand. Once touched, the
// form stops auto-writing them (country ← dialing code, follow-up ← lead date).
export interface LeadFormTouched {
  country: boolean;
  followUp: boolean;
}

// One field change + the entry-form conveniences: typing a WhatsApp number
// with a dialing code auto-selects the country (§2, still editable), and the
// follow-up tracks "lead date + 1 day" until edited (§3).
export function applyFieldChange(
  f: LeadFormState,
  k: keyof LeadFormState,
  v: LeadFormState[keyof LeadFormState],
  touched: LeadFormTouched
): LeadFormState {
  const next = { ...f, [k]: v };
  if (k === "country") touched.country = true;
  if (k === "followUpLocal") touched.followUp = true;
  if (k === "whatsappNumber" && !touched.country) {
    const detected = detectCountryFromPhone(String(v));
    if (detected) next.country = detected;
  }
  if (k === "leadDate" && !touched.followUp && v) {
    next.followUpLocal = defaultFollowUpLocal(String(v));
  }
  return next;
}

export function formToPayload(f: LeadFormState) {
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

export function validateLeadForm(f: LeadFormState): string | null {
  if (!f.leadDate) return "Pick the lead date";
  if (!f.source) return "Pick a source";
  if (f.whatsappNumber.replace(/\D/g, "").length < 6) return "Enter a valid WhatsApp number";
  if (!f.status) return "Pick a status";
  if (f.status === "LOST" && !f.lostReason) return "A lost reason is required";
  return null;
}

// ---- shared field grid (create + edit) ----
// The campaign input autocompletes from a <datalist id="lead-campaigns"> the
// hosting page renders once.
export function LeadFields({
  f,
  set,
  catalog,
  onPhoneBlur,
  autoFocusPhone,
}: {
  f: LeadFormState;
  set: <K extends keyof LeadFormState>(k: K, v: LeadFormState[K]) => void;
  catalog: CatalogPick[];
  onPhoneBlur?: () => void;
  autoFocusPhone?: boolean;
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
      {/* WhatsApp number leads, then country (auto-detected from the code, §1/§2) */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5">
          <Label className="text-xs">WhatsApp number</Label>
          <Input
            placeholder="+966 5X XXX XXXX"
            value={f.whatsappNumber}
            onChange={(e) => set("whatsappNumber", e.target.value)}
            onBlur={onPhoneBlur}
            autoFocus={autoFocusPhone}
            inputMode="tel"
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Country</Label>
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
          <Label className="text-xs">Customer name (optional)</Label>
          <Input value={f.customerName} onChange={(e) => set("customerName", e.target.value)} />
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
          <Label className="text-xs">Follow-up</Label>
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

export function DuplicateWarning({ dup }: { dup: DuplicateHit }) {
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
