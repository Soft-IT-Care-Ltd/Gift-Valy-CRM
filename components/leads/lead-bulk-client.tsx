"use client";

// Bulk Lead page (CORRECTIONS Leads §7) — per-source daily counts for days the
// team can't log every lead individually (SPEC §3.1). Gated by leads.bulk.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LEAD_SOURCES, LEAD_SOURCE_LABELS } from "@/lib/lead-constants";
import { dhakaToday } from "@/components/leads/lead-form";

export function LeadBulkClient({ campaigns }: { campaigns: string[] }) {
  const router = useRouter();
  const [dc, setDc] = useState({ date: dhakaToday(), source: "", campaignName: "", count: "" });
  const [saving, setSaving] = useState(false);

  async function saveDailyCount() {
    if (!dc.source) return toast.error("Pick a source");
    const n = Number(dc.count);
    if (!Number.isInteger(n) || n < 0) return toast.error("Enter a valid count");
    setSaving(true);
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
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      return toast.error(d?.error ?? "Failed to save count");
    }
    toast.success("Daily count saved");
    setDc((s) => ({ ...s, count: "" }));
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Bulk lead entry</h1>
          <p className="text-sm text-muted-foreground">
            Record a per-source lead count for a day — it counts toward every
            lead total and the conversion math (§3.1).
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/leads">← Back to leads</Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Bulk daily count</CardTitle>
          <CardDescription>
            Re-saving the same date + source + campaign replaces the earlier
            count (a correction, not an addition).
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
            <Button onClick={saveDailyCount} disabled={saving}>
              {saving ? "Saving…" : "Save count"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <datalist id="lead-campaigns">
        {campaigns.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}
