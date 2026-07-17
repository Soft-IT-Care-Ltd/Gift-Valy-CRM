"use client";

// New Lead entry page (CORRECTIONS Leads §7) — quick entry kept under 30s:
// date/source/country survive a save so several leads in a row are fast.

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LeadFields,
  DuplicateWarning,
  applyFieldChange,
  emptyLeadForm,
  formToPayload,
  validateLeadForm,
  type CatalogPick,
  type DuplicateHit,
  type LeadFormState,
  type LeadFormTouched,
  type UserPick,
} from "@/components/leads/lead-form";

export function LeadNewClient({
  catalog,
  campaigns,
  assignableUsers,
  canAssign,
  me,
}: {
  catalog: CatalogPick[];
  campaigns: string[];
  assignableUsers: UserPick[];
  canAssign: boolean; // leads.reassign — may file the lead under another SE (§8)
  me: UserPick;
}) {
  const router = useRouter();

  const [form, setForm] = useState<LeadFormState>(emptyLeadForm);
  const touched = useRef<LeadFormTouched>({ country: false, followUp: false });
  const [assignTo, setAssignTo] = useState(String(me.id));
  const [saving, setSaving] = useState(false);
  const [dup, setDup] = useState<DuplicateHit | null>(null);
  const dupSeq = useRef(0);

  const set = useCallback(
    <K extends keyof LeadFormState>(k: K, v: LeadFormState[K]) =>
      setForm((s) => applyFieldChange(s, k, v, touched.current)),
    []
  );

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
      body: JSON.stringify({
        ...formToPayload(form),
        ...(canAssign ? { assignedTo: Number(assignTo) } : {}),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      return toast.error(d?.error ?? "Failed to save lead");
    }
    toast.success("Lead saved");
    // Keep date, source and country for fast repeated entry; clear the rest.
    setForm((f) => ({
      ...emptyLeadForm(),
      leadDate: f.leadDate,
      source: f.source,
      country: f.country,
    }));
    touched.current = { country: false, followUp: false };
    setAssignTo(String(me.id));
    setDup(null);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">New lead</h1>
          <p className="text-sm text-muted-foreground">
            Log the lead as it arrives (§3.1). Duplicate numbers are flagged
            with their history.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/leads">← Back to leads</Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Lead details</CardTitle>
          <CardDescription>
            Typing a number with a country code (e.g. +966…) picks the country
            automatically — you can still change it. Date, source and country
            stay put after saving, so several in a row are fast.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <LeadFields
            f={form}
            set={set}
            catalog={catalog}
            onPhoneBlur={() => checkDuplicate(form.whatsappNumber)}
            autoFocusPhone
          />
          {dup && <DuplicateWarning dup={dup} />}

          {/* Assign-on-entry (§8) — only for leads.reassign holders; everyone
              else auto-assigns to themselves and never sees this field. */}
          {canAssign && assignableUsers.length > 1 && (
            <div className="grid gap-1.5 sm:max-w-xs">
              <Label className="text-xs">Assign to</Label>
              <Select value={assignTo} onValueChange={setAssignTo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {assignableUsers.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name}
                      {u.id === me.id ? " (me)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <Link href="/leads">Done</Link>
            </Button>
            <Button onClick={addLead} disabled={saving}>
              {saving ? "Saving…" : "Save lead"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Campaign autocomplete source */}
      <datalist id="lead-campaigns">
        {campaigns.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}
