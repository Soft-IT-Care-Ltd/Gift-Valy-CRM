"use client";

import { useState } from "react";
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

// CORRECTIONS Orders §7 (C8) — the single occasion-reminder setting: how many
// days before a birthday/anniversary the reminder starts surfacing in the SE
// follow-up area (and the "This period" hint on the Occasions page).
export function OccasionSettingsClient({ initial }: { initial: number }) {
  const router = useRouter();
  const [leadDays, setLeadDays] = useState(String(initial));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/occasions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadDays: Number(leadDays) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save");
      setLeadDays(String(body.leadDays));
      toast.success("Occasion reminder settings saved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Occasion reminders</h1>
        <p className="text-sm text-muted-foreground">
          The repeat-sale engine (CORRECTIONS Orders §7). Upcoming recipient
          birthdays &amp; anniversaries surface in the SE dashboard follow-up area
          this many days ahead, so the team can pitch the customer in time.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reminder lead time</CardTitle>
          <CardDescription>
            How many days before the occasion the reminder appears. Default 7.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid max-w-xs gap-1">
            <Label htmlFor="leadDays">Days before</Label>
            <Input
              id="leadDays"
              type="number"
              min={0}
              max={365}
              value={leadDays}
              onChange={(e) => setLeadDays(e.target.value)}
            />
          </div>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
