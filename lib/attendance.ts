import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import { AuthzError } from "./authz";
import {
  ATTENDANCE_SETTINGS_KEY,
  ATTENDANCE_USER_INCLUDE,
  DEFAULT_ATTENDANCE_SETTINGS,
  HHMM_RE,
  attendanceSettingsToJson,
  deriveDayPlanStatus,
  dhakaMinutesOfDay,
  dhakaYmd,
  dayStartUTC,
  monthDays,
  normalizeAttendanceSettings,
  parseHHMM,
  resolveDayPlan,
  serializeShift,
  weekdayOfYmd,
  workedHours,
  ymdOfDateCol,
  type AttendanceSettings,
  type AttendanceStatusValue,
  type DayCellStatus,
  type DayPlan,
  type RosterDay,
  type RosterVersion,
  type ShiftDef,
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

// ---------- R10 shifts (Admin CRUD) ----------

export const shiftSchema = z
  .object({
    name: z.string().trim().min(1, "Name the shift").max(60),
    startTime: z.string().regex(HHMM_RE, "Start time must be HH:MM"),
    endTime: z.string().regex(HHMM_RE, "End time must be HH:MM"),
    lateAfterMin: z.number().int().min(0).max(720),
    halfDayAfterMin: z.number().int().min(1).max(1440).nullable(),
    isActive: z.boolean(),
  })
  .refine((s) => parseHHMM(s.endTime)! > parseHHMM(s.startTime)!, {
    message: "End must be after start (overnight shifts aren't supported)",
    path: ["endTime"],
  });

export type ShiftInput = z.infer<typeof shiftSchema>;

export async function getShifts(db: Tx = prisma): Promise<ShiftDef[]> {
  const rows = await db.shift.findMany({
    orderBy: [{ startTime: "asc" }, { name: "asc" }],
  });
  return rows.map(serializeShift);
}

export async function createShift(
  raw: unknown,
  actorId: number,
  db: Tx = prisma
): Promise<ShiftDef> {
  const data = shiftSchema.parse(raw);
  const row = await db.shift.create({
    data: { ...data, createdBy: actorId, updatedBy: actorId },
  });
  return serializeShift(row);
}

export async function updateShift(
  id: number,
  raw: unknown,
  actorId: number,
  db: Tx = prisma
): Promise<{ before: ShiftDef; after: ShiftDef }> {
  const data = shiftSchema.parse(raw);
  const existing = await db.shift.findUnique({ where: { id } });
  if (!existing) throw new AuthzError(404, "Shift not found");
  const row = await db.shift.update({
    where: { id },
    data: { ...data, updatedBy: actorId },
  });
  return { before: serializeShift(existing), after: serializeShift(row) };
}

// A shift referenced anywhere in roster history can't be deleted (that history
// must keep resolving) — deactivate it instead.
export async function deleteShift(id: number, db: Tx = prisma): Promise<ShiftDef> {
  const existing = await db.shift.findUnique({ where: { id } });
  if (!existing) throw new AuthzError(404, "Shift not found");
  const used = await db.rosterAssignment.count({ where: { shiftId: id } });
  if (used > 0) {
    throw new AuthzError(
      400,
      "This shift is used in a roster — deactivate it instead of deleting"
    );
  }
  await db.shift.delete({ where: { id } });
  return serializeShift(existing);
}

// ---------- R10 weekly roster (versions by effective date) ----------

export interface RosterData {
  versionsByUser: Map<number, RosterVersion[]>; // sorted by `from` ascending
  shiftsById: Map<number, ShiftDef>;
}

// Load every roster version (optionally for a subset of users) + all shifts —
// inactive shifts included so historical versions keep resolving.
export async function loadRosterData(
  db: Tx = prisma,
  userIds?: number[]
): Promise<RosterData> {
  const [assignments, shifts] = await Promise.all([
    db.rosterAssignment.findMany({
      where: userIds ? { userId: { in: userIds } } : undefined,
      orderBy: [{ userId: "asc" }, { effectiveFrom: "asc" }, { weekday: "asc" }],
      select: {
        userId: true,
        effectiveFrom: true,
        weekday: true,
        shiftId: true,
      },
    }),
    getShifts(db),
  ]);

  const versionsByUser = new Map<number, RosterVersion[]>();
  for (const a of assignments) {
    const from = ymdOfDateCol(a.effectiveFrom);
    const versions = versionsByUser.get(a.userId) ?? [];
    let version = versions[versions.length - 1];
    if (!version || version.from !== from) {
      version = { from, days: Array<RosterDay>(7).fill(null) };
      versions.push(version);
    }
    if (a.weekday >= 0 && a.weekday <= 6) {
      version.days[a.weekday] = a.shiftId ?? "OFF";
    }
    versionsByUser.set(a.userId, versions);
  }
  return {
    versionsByUser,
    shiftsById: new Map(shifts.map((s) => [s.id, s])),
  };
}

// One person's plan for one day (roster → shift/off, else office-hours default).
export async function resolveUserDayPlan(
  userId: number,
  ymd: string,
  db: Tx = prisma,
  settings?: AttendanceSettings
): Promise<DayPlan> {
  const [s, roster] = await Promise.all([
    settings ?? getAttendanceSettings(db),
    loadRosterData(db, [userId]),
  ]);
  return resolveDayPlan(
    ymd,
    roster.versionsByUser.get(userId) ?? [],
    roster.shiftsById,
    s
  );
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export const rosterWeekSchema = z.object({
  userId: z.number().int().positive(),
  effectiveFrom: z.string().regex(YMD_RE, "Pick an effective date"),
  // 0=Sun … 6=Sat: a shift id, "OFF", or null = default office hours.
  days: z
    .array(z.union([z.number().int().positive(), z.literal("OFF"), z.null()]))
    .length(7),
});

export type RosterWeekInput = z.infer<typeof rosterWeekSchema>;

// Save one person's week as the version at `effectiveFrom` (upsert per weekday;
// a "default" cell deletes its row). Saving all-default removes the version —
// the person falls back to office hours from that date. Past versions are never
// touched, so history is preserved.
export async function saveRosterWeek(
  raw: unknown,
  actorId: number,
  db: Tx = prisma
): Promise<RosterWeekInput> {
  const data = rosterWeekSchema.parse(raw);
  const shiftIds = [
    ...new Set(data.days.filter((d): d is number => typeof d === "number")),
  ];
  if (shiftIds.length > 0) {
    const found = await db.shift.count({ where: { id: { in: shiftIds } } });
    if (found !== shiftIds.length) {
      throw new AuthzError(400, "Unknown shift in the roster");
    }
  }
  const user = await db.user.findUnique({
    where: { id: data.userId },
    select: { id: true },
  });
  if (!user) throw new AuthzError(404, "Employee not found");

  const effectiveFrom = dayStartUTC(data.effectiveFrom);
  for (let weekday = 0; weekday < 7; weekday++) {
    const day = data.days[weekday];
    const where = {
      userId_effectiveFrom_weekday: {
        userId: data.userId,
        effectiveFrom,
        weekday,
      },
    };
    if (day === null) {
      await db.rosterAssignment.deleteMany({
        where: { userId: data.userId, effectiveFrom, weekday },
      });
    } else {
      const shiftId = day === "OFF" ? null : day;
      await db.rosterAssignment.upsert({
        where,
        update: { shiftId, updatedBy: actorId },
        create: {
          userId: data.userId,
          effectiveFrom,
          weekday,
          shiftId,
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
    }
  }
  return data;
}

export interface RosterEmployee {
  id: number;
  name: string;
  roleName: string;
  teamName: string | null;
  versions: RosterVersion[];
}

// Everything the roster grid needs: active employees with their full version
// history, plus every shift.
export async function getRosterOverview(db: Tx = prisma): Promise<{
  employees: RosterEmployee[];
  shifts: ShiftDef[];
}> {
  const [users, roster] = await Promise.all([
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
    loadRosterData(db),
  ]);
  return {
    employees: users.map((u) => ({
      id: u.id,
      name: u.name,
      roleName: u.role.name,
      teamName: u.team?.name ?? null,
      versions: roster.versionsByUser.get(u.id) ?? [],
    })),
    shifts: [...roster.shiftsById.values()],
  };
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

// SPEC §11 / R10 — record a server-side check-in for the current Dhaka day.
// Auto-flags Late / Half-day from the check-in time against the person's OWN
// plan for the day (their rostered shift, or the office-hours default). One
// check-in per day: a second attempt is rejected.
export async function checkIn(userId: number, now: Date, db: Tx = prisma) {
  const ymd = dhakaYmd(now);
  const date = dayStartUTC(ymd);

  const existing = await db.attendance.findUnique({
    where: { userId_date: { userId, date } },
  });
  if (existing?.checkInAt) {
    throw new AuthzError(400, "You have already checked in today");
  }

  const plan = await resolveUserDayPlan(userId, ymd, db);
  const status = deriveDayPlanStatus(dhakaMinutesOfDay(now), plan);
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
  shiftName: string | null; // the rostered shift that day (null = default hours or off)
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
  workdays: number; // the person's OWN rostered working days in the month (R10)
  totalWorkHours: number;
}

// The per-day cells and the roll-up counts for one person's month. `now` decides
// which workdays are already in the past (→ ABSENT if unmarked) vs today/future.
// R10: `planFor` resolves the person's own roster (shift / off-day / default),
// so an off-day is never counted absent and workdays follow their roster.
function computeDays(
  monthKey: string,
  now: Date,
  planFor: (ymd: string) => DayPlan,
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
    const plan = planFor(date);
    const workday = plan.kind === "WORK";
    const shiftName = plan.kind === "WORK" ? plan.shiftName : null;
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

    return {
      date,
      weekday,
      status,
      shiftName,
      checkInAt,
      checkOutAt,
      workedHours: hours,
    };
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
// leave counts and total work hours, evaluated against their own roster.
export async function buildEmployeeMonthlySheet(
  userId: number,
  monthKey: string,
  now: Date,
  db: Tx = prisma
): Promise<EmployeeMonthlySheet> {
  const days = monthDays(monthKey);
  const [settings, user, rows, leaveByUser, roster] = await Promise.all([
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
    loadRosterData(db, [userId]),
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
  const versions = roster.versionsByUser.get(userId) ?? [];
  const { days: cells, counts } = computeDays(
    monthKey,
    now,
    (ymd) => resolveDayPlan(ymd, versions, roster.shiftsById, settings),
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
// every active employee this month, each against their own roster.
export async function buildTeamMonthlySummary(
  monthKey: string,
  now: Date,
  db: Tx = prisma
): Promise<TeamMonthlySummary> {
  const days = monthDays(monthKey);
  const [settings, users, rows, leaveByUser, roster] = await Promise.all([
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
    loadRosterData(db),
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
    const versions = roster.versionsByUser.get(u.id) ?? [];
    const { counts } = computeDays(
      monthKey,
      now,
      (ymd) => resolveDayPlan(ymd, versions, roster.shiftsById, settings),
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
  shiftName: string | null; // their rostered shift today (null = default hours)
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
  offToday: { userId: number; name: string }[]; // rostered/weekly off, not absent
  activeEmployeeCount: number;
}

// Live snapshot for the admin dashboard: who has checked in today (and whether
// they are still in), who is on approved leave, and — R10 — whose roster says
// today is an off-day (shown separately, never among the missing).
export async function whoIsInToday(
  now: Date,
  db: Tx = prisma
): Promise<WhoIsInToday> {
  const ymd = dhakaYmd(now);
  const date = dayStartUTC(ymd);

  const [rows, leaves, activeUsers, settings, roster] = await Promise.all([
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
    db.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getAttendanceSettings(db),
    loadRosterData(db),
  ]);

  const planFor = (userId: number) =>
    resolveDayPlan(
      ymd,
      roster.versionsByUser.get(userId) ?? [],
      roster.shiftsById,
      settings
    );

  const entries: WhoIsInEntry[] = rows.map((r) => {
    const plan = planFor(r.userId);
    return {
      userId: r.userId,
      name: r.user.name,
      roleName: r.user.role.name,
      teamName: r.user.team?.name ?? null,
      status: r.status as AttendanceStatusValue,
      shiftName: plan.kind === "WORK" ? plan.shiftName : null,
      checkInAt: r.checkInAt!.toISOString(),
      checkOutAt: r.checkOutAt ? r.checkOutAt.toISOString() : null,
      stillIn: r.checkOutAt == null,
    };
  });
  const checkedIn = new Set(entries.map((e) => e.userId));

  // Off-day per each person's own plan (unless they came in anyway). OFF wins
  // over LEAVE — same precedence as the monthly sheet.
  const offToday = activeUsers.filter(
    (u) => !checkedIn.has(u.id) && planFor(u.id).kind === "OFF"
  );
  const offIds = new Set(offToday.map((u) => u.id));

  // Dedupe leave list (one entry per user); off-day users stay under Off.
  const seen = new Set<number>();
  const onLeave = leaves
    .filter((l) => !offIds.has(l.userId))
    .filter((l) => (seen.has(l.userId) ? false : (seen.add(l.userId), true)))
    .map((l) => ({ userId: l.userId, name: l.user.name }));

  return {
    date: ymd,
    entries,
    stillInCount: entries.filter((e) => e.stillIn).length,
    leftCount: entries.filter((e) => !e.stillIn).length,
    onLeave,
    offToday: offToday.map((u) => ({ userId: u.id, name: u.name })),
    activeEmployeeCount: activeUsers.length,
  };
}

export { DEFAULT_ATTENDANCE_SETTINGS };
