// Hook-free display of "who's in today" (SPEC §11 "আজ কে কে অফিসে আছে" / §13
// Row 4). Rendered on the admin dashboard and the attendance manage page.
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/attendance-constants";
import type { WhoIsInToday } from "@/lib/attendance";

export function WhoIsInCard({
  data,
  showLink = true,
}: {
  data: WhoIsInToday;
  showLink?: boolean;
}) {
  const { entries, stillInCount, leftCount, onLeave, activeEmployeeCount } = data;
  const notInYet = Math.max(
    activeEmployeeCount - entries.length - onLeave.length,
    0
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Who&apos;s in today</CardTitle>
          <CardDescription>
            {stillInCount} in office · {leftCount} left · {onLeave.length} on leave ·{" "}
            {notInYet} not in yet
          </CardDescription>
        </div>
        {showLink && (
          <Link
            href="/attendance/report"
            className="text-sm underline underline-offset-2"
          >
            Report
          </Link>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No one has checked in yet today.
          </p>
        ) : (
          <ul className="divide-y">
            {entries.map((e) => (
              <li
                key={e.userId}
                className="flex items-center justify-between gap-2 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{e.name}</span>
                    {e.stillIn ? (
                      <span
                        className="inline-block h-2 w-2 rounded-full bg-green-500"
                        title="Still in office"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">left</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {e.roleName}
                    {e.teamName ? ` · ${e.teamName}` : ""} · in{" "}
                    {formatDateTime(e.checkInAt)}
                    {e.checkOutAt ? ` · out ${formatDateTime(e.checkOutAt)}` : ""}
                  </div>
                </div>
                <Badge
                  variant={
                    e.status === "PRESENT"
                      ? "secondary"
                      : e.status === "LATE" || e.status === "HALF_DAY"
                        ? "outline"
                        : "default"
                  }
                >
                  {ATTENDANCE_STATUS_LABELS[e.status]}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        {onLeave.length > 0 && (
          <p className="text-xs text-muted-foreground">
            On leave: {onLeave.map((u) => u.name).join(", ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
