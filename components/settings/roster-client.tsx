"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  WEEKDAY_LABELS,
  latestVersionOn,
  type RosterDay,
  type ShiftDef,
} from "@/lib/attendance-constants";
import type { RosterEmployee } from "@/lib/attendance";

// R10 — Admin config: shift definitions + the per-employee weekly roster grid.
// Each grid cell is Default (global office hours) / Off / a shift; saving a row
// writes a new roster version at the chosen effective date, keeping history.

interface ShiftForm {
  name: string;
  startTime: string;
  endTime: string;
  lateAfterMin: string;
  halfDayAfterMin: string;
  isActive: boolean;
}

const EMPTY_SHIFT: ShiftForm = {
  name: "",
  startTime: "09:00",
  endTime: "17:00",
  lateAfterMin: "15",
  halfDayAfterMin: "",
  isActive: true,
};

// Grid cell encoding for the <select>: "" = default hours, "OFF", or a shift id.
const cellValue = (d: RosterDay) => (d === null ? "" : String(d));
const cellFromValue = (v: string): RosterDay =>
  v === "" ? null : v === "OFF" ? "OFF" : Number(v);

export function RosterClient({
  shifts,
  employees,
  today,
  defaultHours,
}: {
  shifts: ShiftDef[];
  employees: RosterEmployee[];
  today: string;
  defaultHours: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // ----- shift editor -----
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<ShiftForm>(EMPTY_SHIFT);

  const openNew = () => {
    setEditing("new");
    setForm(EMPTY_SHIFT);
  };
  const openEdit = (s: ShiftDef) => {
    setEditing(s.id);
    setForm({
      name: s.name,
      startTime: s.startTime,
      endTime: s.endTime,
      lateAfterMin: String(s.lateAfterMin),
      halfDayAfterMin: s.halfDayAfterMin != null ? String(s.halfDayAfterMin) : "",
      isActive: s.isActive,
    });
  };

  async function saveShift() {
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        startTime: form.startTime,
        endTime: form.endTime,
        lateAfterMin: Number(form.lateAfterMin || 0),
        halfDayAfterMin:
          form.halfDayAfterMin.trim() === "" ? null : Number(form.halfDayAfterMin),
        isActive: form.isActive,
      };
      const res = await fetch(
        editing === "new" ? "/api/shifts" : `/api/shifts/${editing}`,
        {
          method: editing === "new" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save the shift");
      toast.success(editing === "new" ? "Shift created" : "Shift updated");
      setEditing(null);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the shift");
    } finally {
      setBusy(false);
    }
  }

  async function removeShift(s: ShiftDef) {
    if (!confirm(`Delete the "${s.name}" shift?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/shifts/${s.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not delete");
      toast.success("Shift deleted");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setBusy(false);
    }
  }

  // ----- roster grid -----
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  // Draft week per employee; baseline = their version effective on that date.
  const [drafts, setDrafts] = useState<Record<number, RosterDay[]>>({});

  const baselines = useMemo(() => {
    const map = new Map<number, { days: RosterDay[]; from: string | null }>();
    for (const e of employees) {
      const v = latestVersionOn(e.versions, effectiveFrom);
      map.set(e.id, {
        days: v ? [...v.days] : Array<RosterDay>(7).fill(null),
        from: v?.from ?? null,
      });
    }
    return map;
  }, [employees, effectiveFrom]);

  const weekOf = (userId: number) =>
    drafts[userId] ?? baselines.get(userId)!.days;

  const isDirty = (userId: number) => {
    const draft = drafts[userId];
    if (!draft) return false;
    const base = baselines.get(userId)!.days;
    return draft.some((d, i) => d !== base[i]);
  };

  const setCell = (userId: number, weekday: number, value: RosterDay) =>
    setDrafts((prev) => {
      const week = [...(prev[userId] ?? baselines.get(userId)!.days)];
      week[weekday] = value;
      return { ...prev, [userId]: week };
    });

  const changeDate = (v: string) => {
    setEffectiveFrom(v);
    setDrafts({}); // drafts were relative to the old date's baseline
  };

  async function saveRoster(userId: number) {
    setBusy(true);
    try {
      const res = await fetch("/api/roster", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, effectiveFrom, days: weekOf(userId) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save the roster");
      toast.success(`Roster saved — applies from ${effectiveFrom}`);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the roster");
    } finally {
      setBusy(false);
    }
  }

  const activeShifts = shifts.filter((s) => s.isActive);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Shifts &amp; roster</h1>
        <p className="text-sm text-muted-foreground">
          R10 — define shifts, then assign each employee a weekly pattern of
          shifts and off-days. Anyone (or any day) without a roster follows the
          default office hours ({defaultHours}) from{" "}
          <Link href="/settings/attendance" className="underline underline-offset-2">
            Attendance Settings
          </Link>
          .
        </p>
      </div>

      {/* Shift definitions */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Shifts</CardTitle>
            <CardDescription>
              Late/half-day thresholds are minutes after each shift&apos;s own
              start (times in Asia/Dhaka).
            </CardDescription>
          </div>
          <Button size="sm" onClick={openNew} disabled={busy}>
            New shift
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead className="text-right">Late after</TableHead>
                  <TableHead className="text-right">Half-day after</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shifts.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      {s.startTime}–{s.endTime}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.lateAfterMin} min
                    </TableCell>
                    <TableCell className="text-right">
                      {s.halfDayAfterMin != null ? `${s.halfDayAfterMin} min` : "—"}
                    </TableCell>
                    <TableCell>
                      {s.isActive ? (
                        <Badge variant="secondary">Active</Badge>
                      ) : (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(s)}
                        disabled={busy}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600"
                        onClick={() => removeShift(s)}
                        disabled={busy}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {shifts.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-6 text-center text-muted-foreground"
                    >
                      No shifts yet — everyone follows the default office hours.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {editing !== null && (
            <div className="rounded-md border p-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="grid gap-1">
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={form.name}
                    placeholder="e.g. Morning"
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">Start</Label>
                  <Input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">End</Label>
                  <Input
                    type="time"
                    value={form.endTime}
                    onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">Late after (min past start)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.lateAfterMin}
                    onChange={(e) =>
                      setForm({ ...form, lateAfterMin: e.target.value })
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">
                    Half-day after (min past start){" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="disabled"
                    value={form.halfDayAfterMin}
                    onChange={(e) =>
                      setForm({ ...form, halfDayAfterMin: e.target.value })
                    }
                  />
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <Checkbox
                    checked={form.isActive}
                    onCheckedChange={(v) => setForm({ ...form, isActive: v === true })}
                  />
                  Active (can be picked in the roster)
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(null)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={saveShift} disabled={busy}>
                  {editing === "new" ? "Create shift" : "Save shift"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Weekly roster grid */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Weekly roster</CardTitle>
            <CardDescription>
              Per weekday: a shift, an off-day, or the default office hours.
              Saving a row creates a new version from the effective date —
              earlier days keep the roster they had.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Applies from</Label>
            <Input
              type="date"
              value={effectiveFrom}
              onChange={(e) => e.target.value && changeDate(e.target.value)}
              className="w-40"
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  {WEEKDAY_LABELS.map((w) => (
                    <TableHead key={w} className="text-center">
                      {w}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Save</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((emp) => {
                  const base = baselines.get(emp.id)!;
                  const week = weekOf(emp.id);
                  return (
                    <TableRow key={emp.id}>
                      <TableCell>
                        <div className="font-medium">{emp.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {emp.roleName}
                          {base.from
                            ? ` · roster since ${base.from}`
                            : " · default hours"}
                        </div>
                      </TableCell>
                      {week.map((day, weekday) => (
                        <TableCell key={weekday} className="p-1 text-center">
                          <select
                            value={cellValue(day)}
                            onChange={(e) =>
                              setCell(emp.id, weekday, cellFromValue(e.target.value))
                            }
                            aria-label={`${emp.name} ${WEEKDAY_LABELS[weekday]}`}
                            className={`h-8 w-full min-w-24 rounded-md border bg-background px-1 text-xs ${
                              day === "OFF" ? "text-muted-foreground" : ""
                            }`}
                          >
                            <option value="">Default</option>
                            <option value="OFF">Off</option>
                            {activeShifts.map((s) => (
                              <option key={s.id} value={String(s.id)}>
                                {s.name}
                              </option>
                            ))}
                            {/* Keep a now-inactive shift selectable while it's the saved value */}
                            {typeof day === "number" &&
                              !activeShifts.some((s) => s.id === day) && (
                                <option value={String(day)}>
                                  {shifts.find((s) => s.id === day)?.name ??
                                    `Shift #${day}`}
                                </option>
                              )}
                          </select>
                        </TableCell>
                      ))}
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={isDirty(emp.id) ? "default" : "outline"}
                          onClick={() => saveRoster(emp.id)}
                          disabled={busy || !isDirty(emp.id)}
                        >
                          Save
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {employees.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="py-6 text-center text-muted-foreground"
                    >
                      No active employees.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
