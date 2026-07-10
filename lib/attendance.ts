import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import { AuthzError } from "./authz";
import {
  ATTENDANCE_SETTINGS_KEY,
  ATTENDANCE_USER_INCLUDE,
  DEFAULT_ATTENDANCE_SETTINGS,
  attendanceSettingsToJson,
  deriveCheckInStatus,
  dhakaMinutesOfDay,
  dhakaYmd,
  dayStartUTC,
  isWorkday,
  monthDays,
  normalizeAttendanceSettings,
  weekdayOfYmd,
  workedHours,
  ymdOfDateCol,
  type AttendanceSettings,
  type AttendanceStatusValue,
  type DayCellStatus,
} from "./attendance-constants";

type Tx = Prisma.TransactionClient | PrismaClient;

// ---------- office-hours settings (SPEC §11) ----------

// Read the attendance settings JSON, filling any missing field from defaults so
// a fresh install (no row) still derives Late/Half-day correctly.
export async function getAttendanceSettings(
  db: Tx = prisma
): Promise<AttendanceSettings> {
  const row = await db.setting.findUnique({
    where: { key: ATTENDANCE_SETTINGS_KEY },
  });
  return normalizeAttendanceSettings(
    (row?.value as Partial<AttendanceSettings> | undefined) ?? null
  );
}

export const attendanceSettingsSchema = z.object({
  officeStart: z.string(),
  lateThreshold: z.string(),
  halfDayThreshold: z.string(),
  officeEnd: z.string(),
  workdays: z.array(z.number().int().min(0).max(6)),
});

export async function saveAttendanceSettings(
  raw: unknown,
  db: Tx = prisma
): Promise<AttendanceSettings> {
  // Normalize (drop invalid HH:MM / weekdays) before persisting.
  const parsed = attendanceSettingsSchema.parse(raw);
  const settings = normalizeAttendanceSettings(parsed);
  const value = attendanceSettingsToJson(settings);
  await db.setting.upsert({
    where: { key: ATTENDANCE_SETTINGS_KEY },
    update: { value },
    create: { key: ATTENDANCE_SETTINGS_KEY, value },
  });
  return settings;
}

// ---------- check-in / check-out (SPEC §11 — server-side timestamps) ----------

// Today's attendance row for a user (button state), or null if not yet marked.
export async function getTodayAttendance(
  userId: number,
  now: Date,
  db: Tx = prisma
) {
  const date = dayStartUTC(dhakaYmd(now));
  return db.attendance.findUnique({
    where: { userId_date: { userId, date } },
    include: ATTENDANCE_USER_INCLUDE,
  });
}

// SPEC §11 — record a server-side check-in for the current Dhaka day. Auto-flags
// Late / Half-day from the check-in time against office-hours settings. One
// check-in per day: a second attempt is rejected.
export async function checkIn(userId: number, now: Date, db: Tx = prisma) {
  const settings = await getAttendanceSettings(db);
  const ymd = dhakaYmd(now);
  const date = dayStartUTC(ymd);

  const existing = await db.attendance.findUnique({
    where: { userId_date: { userId, date } },
  });
  if (existing?.checkInAt) {
    throw new AuthzError(400, "You have already checked in today");
  }

  const status = deriveCheckInStatus(dhakaMinutesOfDay(now), settings);
  return db.attendance.create({
    data: {
      userId,
      date,
      checkInAt: now,
      status,
      createdBy: userId,
      updatedBy: userId,
    },
    include: ATTENDANCE_USER_INCLUDE,
  });
}

// SPEC §11 — record a server-side check-out. Requires an existing check-in and
// blocks a second check-out.
export async function checkOut(userId: number, now: Date, db: Tx = prisma) {
  const date = dayStartUTC(dhakaYmd(now));
  const existing = await db.attendance.findUnique({
    where: { userId_date: { userId, date } },
  });
  if (!existing?.checkInAt) {
    throw new AuthzError(400, "Check in first");
  }
  if (existing.checkOutAt) {
    throw new AuthzError(400, "You have already checked out today");
  }
  return db.attendance.update({
    where: { id: existing.id },
    data: { checkOutAt: now, updatedBy: userId },
    include: ATTENDANCE_USER_INCLUDE,
  });
}

// ---------- leave requests (SPEC §11 — simple approval flow) ----------

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export const leaveRequestSchema = z
  .object({
    fromDate: z.string().regex(YMD_RE, "Pick a start date"),
    toDate: z.string().regex(YMD_RE, "Pick an end date"),
    reason: z.string().trim().min(3, "Give a short reason").max(500),
  })
  .refine((d) => d.toDate >= d.fromDate, {
    message: "End date can't be before the start date",
    path: ["toDate"],
  });

export type LeaveRequestPayload = z.infer<typeof leaveRequestSchema>;

export async function createLeaveRequest(
  userId: number,
  data: LeaveRequestPayload,
  db: Tx = prisma
): Promise<{ id: number }> {
  const created = await db.leaveRequest.create({
    data: {
      userId,
      fromDate: dayStartUTC(data.fromDate),
      toDate: dayStartUTC(data.toDate),
      reason: data.reason,
      status: "PENDING",
      createdBy: userId,
      updatedBy: userId,
    },
    select: { id: true },
  });
  return { id: created.id };
}

// Approve / reject a pending leave request. Only PENDING requests transition.
export async function decideLeaveRequest(
  id: number,
  approve: boolean,
  approverId: number,
  now: Date,
  db: Tx = prisma
): Promise<void> {
  const lr = await db.leaveRequest.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!lr) throw new AuthzError(404, "Leave request not found");
  if (lr.status !== "PENDING") {
    throw new AuthzError(400, `Request is already ${lr.status.toLowerCase()}`);
  }
  await db.leaveRequest.update({
    where: { id },
    data: {
      status: approve ? "APPROVED" : "REJECTED",
      approvedBy: approverId,
      approvedAt: now,
      updatedBy: approverId,
    },
  });
}

// A user cancels their own still-pending request.
export async function cancelLeaveRequest(
  id: number,
  userId: number,
  db: Tx = prisma
): Promise<void> {
  const lr = await db.leaveRequest.findUnique({
    where: { id },
    select: { userId: true, status: true },
  });
  if (!lr) throw new AuthzError(404, "Leave request not found");
  if (lr.userId !== userId) throw new AuthzError(403, "Not your request");
  if (lr.status !== "PENDING") {
    throw new AuthzError(400, "Only pending requests can be withdrawn");
  }
  await db.leaveRequest.delete({ where: { id } });
}

export async function getUserLeaveRequests(userId: number, db: Tx = prisma) {
  return db.leaveRequest.findMany({
    where: { userId },
    include: ATTENDANCE_USER_INCLUDE,
    orderBy: [{ fromDate: "desc" }, { id: "desc" }],
  });
}

export async function getPendingLeaveRequests(db: Tx = prisma) {
  return db.leaveRequest.findMany({
    where: { status: "PENDING" },
    include: ATTENDANCE_USER_INCLUDE,
    orderBy: [{ fromDate: "asc" }, { id: "asc" }],
  });
}

export async function getLeaveRequestsInMonth(monthKey: string, db: Tx = prisma) {
  const days = monthDays(monthKey);
  const start = dayStartUTC(days[0]);
  const end = dayStartUTC(days[days.length - 1]);
  return db.leaveRequest.findMany({
    // Overlaps the month: starts on/before the last day AND ends on/after the first.
    where: { fromDate: { lte: end }, toDate: { gte: start } },
    include: ATTENDANCE_USER_INCLUDE,
    orderBy: [{ status: "asc" }, { fromDate: "asc" }],
  });
}

// The set of in-month YYYY-MM-DD days an APPROVED leave covers, per user.
async function approvedLeaveDaysByUser(
  monthKey: string,
  db: Tx
): Promise<Map<number, Set<string>>> {
  const days = monthDays(monthKey);
  const firstYmd = days[0];
  const lastYmd = days[days.length - 1];
  const leaves = await db.leaveRequest.findMany({
    where: {
      status: "APPROVED",
      fromDate: { lte: dayStartUTC(lastYmd) },
      toDate: { gte: dayStartUTC(firstYmd) },
    },
    select: { userId: true, fromDate: true, toDate: true },
  });
  const byUser = new Map<number, Set<string>>();
  for (const lv of leaves) {
    const set = byUser.get(lv.userId) ?? new Set<string>();
    const from = ymdOfDateCol(lv.fromDate);
    const to = ymdOfDateCol(lv.toDate);
    for (const d of days) {
      if (d >= from && d <= to) set.add(d);
    }
    byUser.set(lv.userId, set);
  }
  return byUser;
}

// ---------- R10 monthly sheet + team summary (SPEC §11 / §12) ----------

export interface DayCell {
  date: string;
  weekday: number;
  status: DayCellStatus;
  checkInAt: string | null;
  checkOutAt: string | null;
  workedHours: number | null;
}

export interface AttendanceCounts {
  present: number; // PRESENT status only
  late: number;
  halfDay: number;
  absent: number;
  leave: number;
  off: number;
  daysPresent: number; // physically in = present + late + half-day
  workdays: number; // office days in the month (isWorkday)
  totalWorkHours: number;
}

// The per-day cells and the roll-up counts for one person's month. `now` decides
// which workdays are already in the past (→ ABSENT if unmarked) vs today/future.
function computeDays(
  monthKey: string,
  now: Date,
  settings: AttendanceSettings,
  rowsByYmd: Map<
    string,
    {
      status: AttendanceStatusValue;
      checkInAt: Date | null;
      checkOutAt: Date | null;
    }
  >,
  leaveYmds: Set<string>
): { days: DayCell[]; counts: AttendanceCounts } {
  const todayYmd = dhakaYmd(now);
  const counts: AttendanceCounts = {
    present: 0,
    late: 0,
    halfDay: 0,
    absent: 0,
    leave: 0,
    off: 0,
    daysPresent: 0,
    workdays: 0,
    totalWorkHours: 0,
  };

  const days = monthDays(monthKey).map<DayCell>((date) => {
    const weekday = weekdayOfYmd(date);
    const workday = isWorkday(weekday, settings);
    if (workday) counts.workdays++;

    const row = rowsByYmd.get(date);
    let status: DayCellStatus;
    let checkInAt: string | null = null;
    let checkOutAt: string | null = null;
    let hours: number | null = null;

    if (row) {
      status = row.status;
      checkInAt = row.checkInAt ? row.checkInAt.toISOString() : null;
      checkOutAt = row.checkOutAt ? row.checkOutAt.toISOString() : null;
      hours = workedHours(row.checkInAt, row.checkOutAt);
    } else if (!workday) {
      status = "OFF";
    } else if (leaveYmds.has(date)) {
      status = "LEAVE";
    } else if (date < todayYmd) {
      status = "ABSENT";
    } else if (date === todayYmd) {
      status = "NOT_MARKED";
    } else {
      status = "UPCOMING";
    }

    switch (status) {
      case "PRESENT":
        counts.present++;
        counts.daysPresent++;
        break;
      case "LATE":
        counts.late++;
        counts.daysPresent++;
        break;
      case "HALF_DAY":
        counts.halfDay++;
        counts.daysPresent++;
        break;
      case "ABSENT":
        counts.absent++;
        break;
      case "LEAVE":
        counts.leave++;
        break;
      case "OFF":
        counts.off++;
        break;
    }
    if (hours != null) counts.totalWorkHours += hours;

    return { date, weekday, status, checkInAt, checkOutAt, workedHours: hours };
  });

  counts.totalWorkHours = Math.round(counts.totalWorkHours * 100) / 100;
  return { days, counts };
}

export interface EmployeeMonthlySheet {
  monthKey: string;
  user: { id: number; name: string };
  settings: AttendanceSettings;
  days: DayCell[];
  counts: AttendanceCounts;
}

// R10 — one employee's month: a day-by-day sheet plus present/late/absent/half/
// leave counts and total work hours.
export async function buildEmployeeMonthlySheet(
  userId: number,
  monthKey: string,
  now: Date,
  db: Tx = prisma
): Promise<EmployeeMonthlySheet> {
  const days = monthDays(monthKey);
  const [settings, user, rows, leaveByUser] = await Promise.all([
    getAttendanceSettings(db),
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true },
    }),
    db.attendance.findMany({
      where: {
        userId,
        date: {
          gte: dayStartUTC(days[0]),
          lte: dayStartUTC(days[days.length - 1]),
        },
      },
      select: { date: true, status: true, checkInAt: true, checkOutAt: true },
    }),
    approvedLeaveDaysByUser(monthKey, db),
  ]);

  const rowsByYmd = new Map(
    rows.map((r) => [
      ymdOfDateCol(r.date),
      {
        status: r.status as AttendanceStatusValue,
        checkInAt: r.checkInAt,
        checkOutAt: r.checkOutAt,
      },
    ])
  );
  const { days: cells, counts } = computeDays(
    monthKey,
    now,
    settings,
    rowsByYmd,
    leaveByUser.get(userId) ?? new Set()
  );
  return { monthKey, user, settings, days: cells, counts };
}

export interface TeamSummaryRow {
  userId: number;
  name: string;
  roleName: string;
  teamName: string | null;
  counts: AttendanceCounts;
}

export interface TeamMonthlySummary {
  monthKey: string;
  settings: AttendanceSettings;
  rows: TeamSummaryRow[];
}

// R10 — team summary: present/late/absent/half/leave counts and work hours for
// every active employee this month.
export async function buildTeamMonthlySummary(
  monthKey: string,
  now: Date,
  db: Tx = prisma
): Promise<TeamMonthlySummary> {
  const days = monthDays(monthKey);
  const [settings, users, rows, leaveByUser] = await Promise.all([
    getAttendanceSettings(db),
    db.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        role: { select: { name: true } },
        team: { select: { name: true } },
      },
    }),
    db.attendance.findMany({
      where: {
        date: {
          gte: dayStartUTC(days[0]),
          lte: dayStartUTC(days[days.length - 1]),
        },
      },
      select: {
        userId: true,
        date: true,
        status: true,
        checkInAt: true,
        checkOutAt: true,
      },
    }),
    approvedLeaveDaysByUser(monthKey, db),
  ]);

  const rowsByUser = new Map<
    number,
    Map<
      string,
      {
        status: AttendanceStatusValue;
        checkInAt: Date | null;
        checkOutAt: Date | null;
      }
    >
  >();
  for (const r of rows) {
    const m = rowsByUser.get(r.userId) ?? new Map();
    m.set(ymdOfDateCol(r.date), {
      status: r.status as AttendanceStatusValue,
      checkInAt: r.checkInAt,
      checkOutAt: r.checkOutAt,
    });
    rowsByUser.set(r.userId, m);
  }

  const summaryRows = users.map((u) => {
    const { counts } = computeDays(
      monthKey,
      now,
      settings,
      rowsByUser.get(u.id) ?? new Map(),
      leaveByUser.get(u.id) ?? new Set()
    );
    return {
      userId: u.id,
      name: u.name,
      roleName: u.role.name,
      teamName: u.team?.name ?? null,
      counts,
    };
  });

  return { monthKey, settings, rows: summaryRows };
}

// ---------- "Who's in today" widget (SPEC §11 / §13 Row 4) ----------

export interface WhoIsInEntry {
  userId: number;
  name: string;
  roleName: string;
  teamName: string | null;
  status: AttendanceStatusValue;
  checkInAt: string;
  checkOutAt: string | null;
  stillIn: boolean;
}

export interface WhoIsInToday {
  date: string;
  entries: WhoIsInEntry[]; // checked in today, earliest first
  stillInCount: number;
  leftCount: number;
  onLeave: { userId: number; name: string }[];
  activeEmployeeCount: number;
}

// Live snapshot for the admin dashboard: who has checked in today (and whether
// they are still in), plus who is on approved leave today.
export async function whoIsInToday(
  now: Date,
  db: Tx = prisma
): Promise<WhoIsInToday> {
  const ymd = dhakaYmd(now);
  const date = dayStartUTC(ymd);

  const [rows, leaves, activeEmployeeCount] = await Promise.all([
    db.attendance.findMany({
      where: { date, checkInAt: { not: null } },
      orderBy: { checkInAt: "asc" },
      select: {
        userId: true,
        status: true,
        checkInAt: true,
        checkOutAt: true,
        user: {
          select: {
            name: true,
            role: { select: { name: true } },
            team: { select: { name: true } },
          },
        },
      },
    }),
    db.leaveRequest.findMany({
      where: {
        status: "APPROVED",
        fromDate: { lte: date },
        toDate: { gte: date },
      },
      select: { userId: true, user: { select: { name: true } } },
    }),
    db.user.count({ where: { isActive: true } }),
  ]);

  const entries: WhoIsInEntry[] = rows.map((r) => ({
    userId: r.userId,
    name: r.user.name,
    roleName: r.user.role.name,
    teamName: r.user.team?.name ?? null,
    status: r.status as AttendanceStatusValue,
    checkInAt: r.checkInAt!.toISOString(),
    checkOutAt: r.checkOutAt ? r.checkOutAt.toISOString() : null,
    stillIn: r.checkOutAt == null,
  }));

  // Dedupe leave list (one entry per user).
  const seen = new Set<number>();
  const onLeave = leaves
    .filter((l) => (seen.has(l.userId) ? false : (seen.add(l.userId), true)))
    .map((l) => ({ userId: l.userId, name: l.user.name }));

  return {
    date: ymd,
    entries,
    stillInCount: entries.filter((e) => e.stillIn).length,
    leftCount: entries.filter((e) => !e.stillIn).length,
    onLeave,
    activeEmployeeCount,
  };
}

export { DEFAULT_ATTENDANCE_SETTINGS };
