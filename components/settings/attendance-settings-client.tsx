"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  WEEKDAY_LABELS,
  type AttendanceSettings,
} from "@/lib/attendance-constants";

// SPEC §11 — office hours, late/half-day thresholds and the working-day pattern.
// These drive the auto Late / Absent / Half-day flags.
export function AttendanceSettingsClient({
  initial,
}: {
  initial: AttendanceSettings;
}) {
  const router = useRouter();
  const [s, setS] = useState<AttendanceSettings>(initial);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<AttendanceSettings>) =>
    setS((prev) => ({ ...prev, ...patch }));

  const toggleDay = (day: number) =>
    setS((prev) => ({
      ...prev,
      workdays: prev.workdays.includes(day)
        ? prev.workdays.filter((d) => d !== day)
        : [...prev.workdays, day].sort((a, b) => a - b),
    }));

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/attendance/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save");
      setS(body as AttendanceSettings);
      toast.success("Attendance settings saved");
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
        <h1 className="text-2xl font-semibold">Attendance settings</h1>
        <p className="text-sm text-muted-foreground">
          Office hours and thresholds that auto-flag Late, Half-day and Absent
          (times in Asia/Dhaka).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Office hours</CardTitle>
          <CardDescription>
            A check-in after the late threshold is Late; at/after the half-day
            threshold it&apos;s a Half-day. Leave the half-day threshold blank to
            disable it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <TimeField
            label="Office start"
            value={s.officeStart}
            onChange={(v) => set({ officeStart: v })}
          />
          <TimeField
            label="Late after"
            value={s.lateThreshold}
            onChange={(v) => set({ lateThreshold: v })}
          />
          <TimeField
            label="Half-day after"
            value={s.halfDayThreshold}
            onChange={(v) => set({ halfDayThreshold: v })}
            allowEmpty
          />
          <TimeField
            label="Office end"
            value={s.officeEnd}
            onChange={(v) => set({ officeEnd: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Working days</CardTitle>
          <CardDescription>
            Days not ticked are weekly offs — never counted as Absent.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          {WEEKDAY_LABELS.map((label, day) => (
            <label
              key={label}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox
                checked={s.workdays.includes(day)}
                onCheckedChange={() => toggleDay(day)}
              />
              {label}
            </label>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>
          Save settings
        </Button>
      </div>
    </div>
  );
}

function TimeField({
  label,
  value,
  onChange,
  allowEmpty = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">
        {label}
        {allowEmpty && (
          <span className="ml-1 text-muted-foreground">(optional)</span>
        )}
      </Label>
      <Input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
