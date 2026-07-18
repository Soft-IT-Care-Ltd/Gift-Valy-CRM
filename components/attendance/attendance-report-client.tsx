"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toCsv, downloadCsv, csvDateStamp } from "@/lib/csv";
import { formatDate, formatDateTime } from "@/lib/format";
import { monthLabel } from "@/lib/targets-constants";
import { DAY_CELL_LABELS, WEEKDAY_LABELS } from "@/lib/attendance-constants";
import { ExportPdfButton } from "@/components/reports/export-pdf-button";
import type { ReportPdfPayload } from "@/lib/report-pdf";
import type {
  EmployeeMonthlySheet,
  TeamMonthlySummary,
} from "@/lib/attendance";
import { MonthGrid } from "@/components/attendance/month-grid";

export function AttendanceReportClient({
  monthKey,
  employees,
  selectedUserId,
  summary,
  sheet,
}: {
  monthKey: string;
  employees: { id: number; name: string }[];
  selectedUserId: number | null;
  summary: TeamMonthlySummary;
  sheet: EmployeeMonthlySheet | null;
}) {
  const router = useRouter();

  const nav = (next: { month?: string; user?: number | null }) => {
    const params = new URLSearchParams();
    params.set("month", next.month ?? monthKey);
    const user = next.user === undefined ? selectedUserId : next.user;
    if (user != null) params.set("user", String(user));
    router.push(`/attendance/report?${params}`);
  };

  const shiftMonth = (delta: number) => {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    nav({
      month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    });
  };

  function exportSummary() {
    const headers = [
      "Employee",
      "Role",
      "Team",
      "Present",
      "Late",
      "Half-day",
      "Absent",
      "On leave",
      "Days present",
      "Workdays",
      "Work hours",
    ];
    const body = summary.rows.map((r) => [
      r.name,
      r.roleName,
      r.teamName ?? "",
      r.counts.present,
      r.counts.late,
      r.counts.halfDay,
      r.counts.absent,
      r.counts.leave,
      r.counts.daysPresent,
      r.counts.workdays,
      r.counts.totalWorkHours,
    ]);
    downloadCsv(
      `attendance-summary-${monthKey}-${csvDateStamp()}.csv`,
      toCsv(headers, body)
    );
  }

  function exportSheet() {
    if (!sheet) return;
    const headers = [
      "Date",
      "Weekday",
      "Shift",
      "Status",
      "Check-in",
      "Check-out",
      "Hours",
    ];
    const body = sheet.days.map((d) => [
      d.date,
      WEEKDAY_LABELS[d.weekday],
      d.shiftName ?? (d.status === "OFF" ? "" : "Default"),
      DAY_CELL_LABELS[d.status],
      d.checkInAt ? formatDateTime(d.checkInAt) : "",
      d.checkOutAt ? formatDateTime(d.checkOutAt) : "",
      d.workedHours ?? "",
    ]);
    downloadCsv(
      `attendance-${sheet.user.name.replace(/\s+/g, "-")}-${monthKey}.csv`,
      toCsv(headers, body)
    );
  }

  function pdfPayload(): ReportPdfPayload {
    const sections: ReportPdfPayload["sections"] = [
      {
        heading: "Team summary",
        note: "Present / late / absent / half-day / leave counts and work hours per employee.",
        headers: [
          "Employee",
          "Role",
          "Team",
          "Present",
          "Late",
          "Half",
          "Absent",
          "Leave",
          "Hours",
        ],
        aligns: ["l", "l", "l", "r", "r", "r", "r", "r", "r"],
        rows: summary.rows.map((r) => [
          r.name,
          r.roleName,
          r.teamName ?? "—",
          r.counts.present,
          r.counts.late || "—",
          r.counts.halfDay || "—",
          r.counts.absent || "—",
          r.counts.leave || "—",
          r.counts.totalWorkHours,
        ]),
      },
    ];
    if (sheet) {
      sections.push({
        heading: `Monthly sheet — ${sheet.user.name}`,
        note: `Present ${sheet.counts.present} · Late ${sheet.counts.late} · Half-day ${sheet.counts.halfDay} · Absent ${sheet.counts.absent} · On leave ${sheet.counts.leave} · Work hours ${sheet.counts.totalWorkHours}`,
        headers: [
          "Date",
          "Weekday",
          "Shift",
          "Status",
          "Check-in",
          "Check-out",
          "Hours",
        ],
        aligns: ["l", "l", "l", "l", "l", "l", "r"],
        rows: sheet.days.map((d) => [
          formatDate(d.date),
          WEEKDAY_LABELS[d.weekday],
          d.shiftName ?? (d.status === "OFF" ? "—" : "Default"),
          DAY_CELL_LABELS[d.status],
          d.checkInAt ? formatDateTime(d.checkInAt) : "—",
          d.checkOutAt ? formatDateTime(d.checkOutAt) : "—",
          d.workedHours ?? "—",
        ]),
      });
    }
    return {
      title: "Attendance Report (R10)",
      subtitle: monthLabel(monthKey),
      landscape: true,
      sections,
    };
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Attendance report</h1>
          <p className="text-sm text-muted-foreground">
            R10 — {monthLabel(monthKey)} per-employee sheet and team summary.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => shiftMonth(-1)}>
            ← Prev
          </Button>
          <input
            type="month"
            value={monthKey}
            onChange={(e) => e.target.value && nav({ month: e.target.value })}
            className="h-9 rounded-md border bg-background px-2 text-sm"
            aria-label="Month"
          />
          <Button variant="outline" size="sm" onClick={() => shiftMonth(1)}>
            Next →
          </Button>
          <ExportPdfButton
            filename={`attendance-report-${monthKey}-${csvDateStamp()}.pdf`}
            build={pdfPayload}
          />
        </div>
      </div>

      {/* Team summary (SPEC §11) */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Team summary</CardTitle>
            <CardDescription>
              Present / late / absent / half-day / leave counts and work hours
              per employee — each judged against their own roster (R10).
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={exportSummary}
            disabled={summary.rows.length === 0}
          >
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Present</TableHead>
                  <TableHead className="text-right">Late</TableHead>
                  <TableHead className="text-right">Half</TableHead>
                  <TableHead className="text-right">Absent</TableHead>
                  <TableHead className="text-right">Leave</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Sheet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.rows.map((r) => (
                  <TableRow
                    key={r.userId}
                    className={r.userId === selectedUserId ? "bg-muted/50" : ""}
                  >
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.roleName}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.teamName ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">{r.counts.present}</TableCell>
                    <TableCell className="text-right text-amber-700">
                      {r.counts.late || "—"}
                    </TableCell>
                    <TableCell className="text-right text-sky-700">
                      {r.counts.halfDay || "—"}
                    </TableCell>
                    <TableCell className="text-right text-red-600">
                      {r.counts.absent || "—"}
                    </TableCell>
                    <TableCell className="text-right text-violet-700">
                      {r.counts.leave || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.counts.totalWorkHours}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => nav({ user: r.userId })}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {summary.rows.length === 0 && (
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

      {/* Per-employee monthly sheet (SPEC §11) */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Monthly sheet</CardTitle>
            <CardDescription>
              Day-by-day attendance for one employee.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={selectedUserId ? String(selectedUserId) : ""}
              onValueChange={(v) => nav({ user: Number(v) })}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={exportSheet}
              disabled={!sheet}
            >
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {sheet ? (
            <MonthGrid days={sheet.days} counts={sheet.counts} />
          ) : (
            <p className="py-6 text-center text-muted-foreground">
              Select an employee to see their sheet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
