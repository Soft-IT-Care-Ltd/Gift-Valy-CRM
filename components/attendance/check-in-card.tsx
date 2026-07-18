"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import {
  ATTENDANCE_STATUS_LABELS,
  describeDayPlan,
  type AttendanceRow,
  type DayPlan,
} from "@/lib/attendance-constants";

// SPEC §11 / R10 — the employee's check-in / check-out control. Buttons POST to
// the server, which stamps the timestamp; the row (with auto Late/Half-day
// status judged against the person's OWN shift) comes back and the page
// refreshes. `plan` is today's resolved roster entry.
export function CheckInCard({
  today,
  plan,
}: {
  today: AttendanceRow | null;
  plan: DayPlan;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const checkedIn = !!today?.checkInAt;
  const checkedOut = !!today?.checkOutAt;

  async function act(path: "check-in" | "check-out") {
    setBusy(true);
    try {
      const res = await fetch(`/api/attendance/${path}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Something went wrong");
      toast.success(path === "check-in" ? "Checked in ✅" : "Checked out 👋");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Today&apos;s attendance</CardTitle>
            <CardDescription>
              {plan.kind === "OFF"
                ? `${describeDayPlan(plan)} — enjoy! A check-in still records your time.`
                : `${describeDayPlan(plan)} (Asia/Dhaka)`}
            </CardDescription>
          </div>
          {today && (
            <Badge
              variant={
                today.status === "PRESENT"
                  ? "secondary"
                  : today.status === "LATE" || today.status === "HALF_DAY"
                    ? "outline"
                    : "default"
              }
            >
              {ATTENDANCE_STATUS_LABELS[today.status]}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Checked in</div>
            <div className="font-medium">
              {today?.checkInAt ? formatDateTime(today.checkInAt) : "—"}
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Checked out</div>
            <div className="font-medium">
              {today?.checkOutAt ? formatDateTime(today.checkOutAt) : "—"}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => act("check-in")}
            disabled={busy || checkedIn}
          >
            {checkedIn ? "Checked in" : "Check in"}
          </Button>
          <Button
            variant="outline"
            onClick={() => act("check-out")}
            disabled={busy || !checkedIn || checkedOut}
          >
            {checkedOut ? "Checked out" : "Check out"}
          </Button>
        </div>
        {today?.workedHours != null && (
          <p className="text-sm text-muted-foreground">
            Worked {today.workedHours} hours today.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
