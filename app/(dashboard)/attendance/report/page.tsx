import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import {
  buildEmployeeMonthlySheet,
  buildTeamMonthlySummary,
} from "@/lib/attendance";
import { monthKeyOf, MONTH_KEY_RE } from "@/lib/attendance-constants";
import { AttendanceReportClient } from "@/components/attendance/attendance-report-client";

export const dynamic = "force-dynamic";

// R10 — Attendance report (SPEC §11 / §12): per-employee monthly sheet + team
// summary. Gated attendance.view_all (Admin, Manager).
export default async function AttendanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; user?: string }>;
}) {
  await requirePagePermission("attendance.view_all");
  const sp = await searchParams;
  const now = new Date();
  const monthKey =
    sp.month && MONTH_KEY_RE.test(sp.month) ? sp.month : monthKeyOf(now);

  const employees = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const requested = Number(sp.user);
  const selectedUserId =
    employees.find((e) => e.id === requested)?.id ?? employees[0]?.id ?? null;

  const [summary, sheet] = await Promise.all([
    buildTeamMonthlySummary(monthKey, now),
    selectedUserId
      ? buildEmployeeMonthlySheet(selectedUserId, monthKey, now)
      : Promise.resolve(null),
  ]);

  return (
    <AttendanceReportClient
      monthKey={monthKey}
      employees={employees}
      selectedUserId={selectedUserId}
      summary={summary}
      sheet={sheet}
    />
  );
}
