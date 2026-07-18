import { requirePagePermission } from "@/lib/page-auth";
import {
  getTodayAttendance,
  resolveUserDayPlan,
  buildEmployeeMonthlySheet,
  getUserLeaveRequests,
} from "@/lib/attendance";
import {
  dhakaYmd,
  monthKeyOf,
  serializeAttendance,
  serializeLeaveRequest,
} from "@/lib/attendance-constants";
import { monthLabel } from "@/lib/targets-constants";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckInCard } from "@/components/attendance/check-in-card";
import { LeavePanel } from "@/components/attendance/leave-panel";
import { MonthGrid } from "@/components/attendance/month-grid";

export const dynamic = "force-dynamic";

// SPEC §11 — an employee's own attendance: check-in/out, this month at a glance,
// and their leave requests. Any staff role (attendance.own).
export default async function AttendancePage() {
  const session = await requirePagePermission("attendance.own");
  const now = new Date();
  const monthKey = monthKeyOf(now);

  const [today, plan, sheet, leaves] = await Promise.all([
    getTodayAttendance(session.user.id, now),
    // R10 — today's plan from THEIR roster (shift / off-day / default hours).
    resolveUserDayPlan(session.user.id, dhakaYmd(now)),
    buildEmployeeMonthlySheet(session.user.id, monthKey, now),
    getUserLeaveRequests(session.user.id),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">My attendance</h1>
        <p className="text-sm text-muted-foreground">
          Check in when you arrive and out when you leave — timestamps are
          recorded on the server.
        </p>
      </div>

      <CheckInCard
        today={today ? serializeAttendance(today) : null}
        plan={plan}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{monthLabel(monthKey)}</CardTitle>
          <CardDescription>
            Your month at a glance. Absent days are your rostered workdays with
            no check-in — off-days never count as absent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MonthGrid days={sheet.days} counts={sheet.counts} />
        </CardContent>
      </Card>

      <LeavePanel requests={leaves.map(serializeLeaveRequest)} />
    </div>
  );
}
