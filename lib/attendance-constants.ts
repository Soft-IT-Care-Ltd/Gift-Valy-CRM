// Attendance & Leave constants, serializers and pure date/time math — SPEC §11.
// Client-safe: only `import type` from Prisma, so the check-in UI, settings form,
// API routes, the R10 report and the verify script share one source of truth
// (mirrors lib/targets-constants.ts). No server (prisma) imports here.
import type { Prisma } from "@prisma/client";

// ---------- enums / labels ----------

export const ATTENDANCE_STATUSES = [
  "PRESENT",
  "LATE",
  "ABSENT",
  "HALF_DAY",
  "LEAVE",
] as const;
export type AttendanceStatusValue = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatusValue, string> = {
  PRESENT: "Present",
  LATE: "Late",
  ABSENT: "Absent",
  HALF_DAY: "Half-day",
  LEAVE: "On leave",
};

// Single-letter codes for the dense monthly grid (R10).
export const ATTENDANCE_STATUS_CODES: Record<AttendanceStatusValue, string> = {
  PRESENT: "P",
  LATE: "L",
  ABSENT: "A",
  HALF_DAY: "½",
  LEAVE: "Lv",
};

export const LEAVE_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type LeaveStatusValue = (typeof LEAVE_STATUSES)[number];

export const LEAVE_STATUS_LABELS: Record<LeaveStatusValue, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

// The per-day cell status in the monthly sheet. On top of the stored statuses,
// a cell can be a weekly OFF day, TODAY-not-yet-marked, or a future UPCOMING day.
export type DayCellStatus = AttendanceStatusValue | "OFF" | "NOT_MARKED" | "UPCOMING";

export const DAY_CELL_LABELS: Record<DayCellStatus, string> = {
  ...ATTENDANCE_STATUS_LABELS,
  OFF: "Weekly off",
  NOT_MARKED: "Not marked",
  UPCOMING: "Upcoming",
};

export const DAY_CELL_CODES: Record<DayCellStatus, string> = {
  ...ATTENDANCE_STATUS_CODES,
  OFF: "—",
  NOT_MARKED: "·",
  UPCOMING: "",
};

export const WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

// ---------- office-hours settings (SPEC §11) ----------

export interface AttendanceSettings {
  officeStart: string; // "HH:MM" (24h, Asia/Dhaka) — expected arrival
  lateThreshold: string; // check-in strictly after this → LATE
  halfDayThreshold: string; // check-in at/after this → HALF_DAY ("" disables)
  officeEnd: string; // expected leave time (used for expected work hours)
  workdays: number[]; // weekday numbers (0=Sun … 6=Sat) that are working days
}

// Bangladesh SME default: Friday (5) is the weekly off; grace of 15 min after a
// 10:00 start; arriving from 13:30 counts as a half-day.
export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettings = {
  officeStart: "10:00",
  lateThreshold: "10:15",
  halfDayThreshold: "13:30",
  officeEnd: "18:00",
  workdays: [0, 1, 2, 3, 4, 6],
};

// The settings-table key holding the JSON blob above.
export const ATTENDANCE_SETTINGS_KEY = "attendance_settings";

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// "HH:MM" → minutes since midnight; null when empty/invalid (a disabled rule).
export function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = HHMM_RE.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Fill any missing/invalid fields from the defaults so a partial settings row
// never breaks status derivation.
export function normalizeAttendanceSettings(
  raw: Partial<AttendanceSettings> | null | undefined
): AttendanceSettings {
  const d = DEFAULT_ATTENDANCE_SETTINGS;
  const valid = (v: unknown, fallback: string) =>
    typeof v === "string" && (v === "" || HHMM_RE.test(v.trim())) ? v : fallback;
  const workdays =
    Array.isArray(raw?.workdays) &&
    raw!.workdays.every((n) => Number.isInteger(n) && n >= 0 && n <= 6)
      ? [...new Set(raw!.workdays)].sort((a, b) => a - b)
      : d.workdays;
  return {
    officeStart: valid(raw?.officeStart, d.officeStart) || d.officeStart,
    lateThreshold: valid(raw?.lateThreshold, d.lateThreshold) || d.lateThreshold,
    // halfDayThreshold may legitimately be "" (disabled).
    halfDayThreshold:
      typeof raw?.halfDayThreshold === "string" &&
      (raw.halfDayThreshold === "" || HHMM_RE.test(raw.halfDayThreshold.trim()))
        ? raw.halfDayThreshold
        : d.halfDayThreshold,
    officeEnd: valid(raw?.officeEnd, d.officeEnd) || d.officeEnd,
    workdays,
  };
}

// ---------- Asia/Dhaka calendar helpers (pure) ----------

// "YYYY-MM-DD" of an instant in Asia/Dhaka (the office day it falls on).
export function dhakaYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// Minutes since 00:00 in Asia/Dhaka for an instant (0–1439).
export function dhakaMinutesOfDay(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")!.value) % 24;
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  return h * 60 + m;
}

// UTC-midnight Date for a "YYYY-MM-DD" — the value stored in the @db.Date
// columns so a write and a later equality read round-trip to the same day.
export function dayStartUTC(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

// "YYYY-MM-DD" for a UTC-midnight @db.Date value read back from the DB.
export function ymdOfDateCol(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

// "YYYY-MM" of an instant, in Asia/Dhaka (the office month).
export function monthKeyOf(d: Date): string {
  return dhakaYmd(d).slice(0, 7);
}

// Cast the settings object to Prisma's JSON input type for the settings table
// (a named interface lacks the index signature InputJsonObject requires).
export function attendanceSettingsToJson(
  s: AttendanceSettings
): Prisma.InputJsonObject {
  return s as unknown as Prisma.InputJsonObject;
}

// Weekday (0=Sun … 6=Sat) of a "YYYY-MM-DD" calendar date.
export function weekdayOfYmd(ymd: string): number {
  return dayStartUTC(ymd).getUTCDay();
}

// Every "YYYY-MM-DD" in a "YYYY-MM" month, in order.
export function monthDays(monthKey: string): string[] {
  const [y, m] = monthKey.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => {
    const day = String(i + 1).padStart(2, "0");
    return `${monthKey}-${day}`;
  });
}

export function isWorkday(weekday: number, s: AttendanceSettings): boolean {
  return s.workdays.includes(weekday);
}

// ---------- status derivation (SPEC §11 auto flags) ----------

// Given a check-in time (minutes since midnight, Dhaka) decide the stored status:
// on time → PRESENT, after the late threshold → LATE, at/after the half-day
// threshold → HALF_DAY. ABSENT/LEAVE are never produced here.
export function deriveCheckInStatus(
  checkInMinutes: number,
  s: AttendanceSettings
): Extract<AttendanceStatusValue, "PRESENT" | "LATE" | "HALF_DAY"> {
  const late = parseHHMM(s.lateThreshold);
  const half = parseHHMM(s.halfDayThreshold);
  if (half != null && checkInMinutes >= half) return "HALF_DAY";
  if (late != null && checkInMinutes > late) return "LATE";
  return "PRESENT";
}

// Worked hours between two timestamps, rounded to 2dp; null if either is missing.
export function workedHours(
  checkInAt: Date | string | null,
  checkOutAt: Date | string | null
): number | null {
  if (!checkInAt || !checkOutAt) return null;
  const a = new Date(checkInAt).getTime();
  const b = new Date(checkOutAt).getTime();
  if (!(b > a)) return null;
  return Math.round(((b - a) / 3_600_000) * 100) / 100;
}

// ---------- serializers ----------

export type AttendanceRowPayload = Prisma.AttendanceGetPayload<{
  include: { user: { select: { id: true; name: true } } };
}>;

export interface AttendanceRow {
  id: number;
  userId: number;
  userName: string;
  date: string; // YYYY-MM-DD
  checkInAt: string | null;
  checkOutAt: string | null;
  status: AttendanceStatusValue;
  workedHours: number | null;
  note: string | null;
}

export function serializeAttendance(a: AttendanceRowPayload): AttendanceRow {
  return {
    id: a.id,
    userId: a.userId,
    userName: a.user.name,
    date: ymdOfDateCol(a.date),
    checkInAt: a.checkInAt ? a.checkInAt.toISOString() : null,
    checkOutAt: a.checkOutAt ? a.checkOutAt.toISOString() : null,
    status: a.status as AttendanceStatusValue,
    workedHours: workedHours(a.checkInAt, a.checkOutAt),
    note: a.note,
  };
}

export type LeaveRequestPayload = Prisma.LeaveRequestGetPayload<{
  include: { user: { select: { id: true; name: true } } };
}>;

export interface LeaveRequestRow {
  id: number;
  userId: number;
  userName: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: LeaveStatusValue;
  approvedBy: number | null;
  approvedAt: string | null;
  createdAt: string;
}

// Inclusive day span of a leave request.
export function leaveDays(fromYmd: string, toYmd: string): number {
  const a = dayStartUTC(fromYmd).getTime();
  const b = dayStartUTC(toYmd).getTime();
  return Math.floor((b - a) / 86_400_000) + 1;
}

export function serializeLeaveRequest(l: LeaveRequestPayload): LeaveRequestRow {
  const fromDate = ymdOfDateCol(l.fromDate);
  const toDate = ymdOfDateCol(l.toDate);
  return {
    id: l.id,
    userId: l.userId,
    userName: l.user.name,
    fromDate,
    toDate,
    days: leaveDays(fromDate, toDate),
    reason: l.reason,
    status: l.status as LeaveStatusValue,
    approvedBy: l.approvedBy,
    approvedAt: l.approvedAt ? l.approvedAt.toISOString() : null,
    createdAt: l.createdAt.toISOString(),
  };
}

export const ATTENDANCE_USER_INCLUDE = {
  user: { select: { id: true, name: true } },
} satisfies Prisma.AttendanceInclude;

export const LEAVE_USER_INCLUDE = {
  user: { select: { id: true, name: true } },
} satisfies Prisma.LeaveRequestInclude;
