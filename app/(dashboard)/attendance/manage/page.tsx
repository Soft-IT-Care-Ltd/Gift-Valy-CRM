import Link from "next/link";
import { requirePagePermission } from "@/lib/page-auth";
import { whoIsInToday, getLeaveRequestsInMonth } from "@/lib/attendance";
import {
  monthKeyOf,
  serializeLeaveRequest,
} from "@/lib/attendance-constants";
import { monthLabel } from "@/lib/targets-constants";
import { Button } from "@/components/ui/button";
import { WhoIsInCard } from "@/components/attendance/who-is-in-card";
import { LeaveApprovalsClient } from "@/components/attendance/leave-approvals-client";

export const dynamic = "force-dynamic";

// SPEC §11 — manager view: who's in today + the leave approval flow. Gated
// attendance.view_all (Admin, Manager).
export default async function AttendanceManagePage() {
  await requirePagePermission("attendance.view_all");
  const now = new Date();
  const monthKey = monthKeyOf(now);

  const [whoIsIn, leaves] = await Promise.all([
    whoIsInToday(now),
    getLeaveRequestsInMonth(monthKey),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Attendance &amp; leave</h1>
          <p className="text-sm text-muted-foreground">
            {monthLabel(monthKey)} — who&apos;s in today and leave approvals.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/attendance/report">Monthly report</Link>
        </Button>
      </div>

      <WhoIsInCard data={whoIsIn} showLink={false} />

      <LeaveApprovalsClient requests={leaves.map(serializeLeaveRequest)} />
    </div>
  );
}
