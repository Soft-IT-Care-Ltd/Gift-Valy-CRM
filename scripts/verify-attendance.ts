// Attendance & Leave verification (SPEC §11). Drives the pure status math, the
// Dhaka calendar helpers, check-in/out (server-side timestamps + auto Late/Half-
// day flags), the leave request → approval flow, absent/leave derivation in the
// R10 monthly sheet, the team summary and the "who's in today" snapshot — all
// inside ONE rolled-back transaction (mirrors verify-targets).
import { PrismaClient } from "@prisma/client";
import {
  ATTENDANCE_SETTINGS_KEY,
  DEFAULT_ATTENDANCE_SETTINGS,
  attendanceSettingsToJson,
  deriveCheckInStatus,
  isWorkday,
  leaveDays,
  monthDays,
  parseHHMM,
  weekdayOfYmd,
} from "../lib/attendance-constants";
import {
  checkIn,
  checkOut,
  getTodayAttendance,
  createLeaveRequest,
  decideLeaveRequest,
  cancelLeaveRequest,
  buildEmployeeMonthlySheet,
  buildTeamMonthlySummary,
  whoIsInToday,
} from "../lib/attendance";

const prisma = new PrismaClient();
const ROLLBACK = "ROLLBACK_SENTINEL";

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label} ${detail}`);
  }
}

async function main() {
  console.log("Attendance & Leave verification — SPEC §11\n");
  const S = DEFAULT_ATTENDANCE_SETTINGS; // office 10:00, late 10:15, half 13:30

  // ---------- pure status math (no DB) ----------
  console.log("Status derivation (§11):");
  check("09:50 → PRESENT", deriveCheckInStatus(parseHHMM("09:50")!, S) === "PRESENT");
  check("10:15 exactly → PRESENT (grace)", deriveCheckInStatus(parseHHMM("10:15")!, S) === "PRESENT");
  check("10:16 → LATE", deriveCheckInStatus(parseHHMM("10:16")!, S) === "LATE");
  check("13:29 → LATE", deriveCheckInStatus(parseHHMM("13:29")!, S) === "LATE");
  check("13:30 exactly → HALF_DAY", deriveCheckInStatus(parseHHMM("13:30")!, S) === "HALF_DAY");
  check("14:00 → HALF_DAY", deriveCheckInStatus(parseHHMM("14:00")!, S) === "HALF_DAY");

  console.log("\nCalendar helpers (§11):");
  check("parse '10:15' = 615", parseHHMM("10:15") === 615);
  check("parse '' = null (disabled)", parseHHMM("") === null);
  check("May 2026 has 31 days", monthDays("2026-05").length === 31);
  // 2026-05-01 is a Friday; the default off day.
  check("2026-05-01 is Friday (5)", weekdayOfYmd("2026-05-01") === 5);
  check("Friday is not a workday by default", !isWorkday(5, S));
  check("Sunday is a workday by default", isWorkday(0, S));
  check("leaveDays inclusive (06→08 = 3)", leaveDays("2026-05-06", "2026-05-08") === 3);

  const seRole = await prisma.role.findUniqueOrThrow({
    where: { name: "SalesExecutive" },
    select: { id: true },
  });

  try {
    await prisma.$transaction(async (tx) => {
      // Deterministic settings inside the tx.
      const sJson = attendanceSettingsToJson(S);
      await tx.setting.upsert({
        where: { key: ATTENDANCE_SETTINGS_KEY },
        update: { value: sJson },
        create: { key: ATTENDANCE_SETTINGS_KEY, value: sJson },
      });

      const mkUser = (email: string, name: string) =>
        tx.user.create({
          data: {
            email,
            name,
            passwordHash: "x",
            roleId: seRole.id,
            isActive: true,
            joinedAt: new Date("2026-01-01T00:00:00Z"),
          },
          select: { id: true, name: true },
        });
      const A = await mkUser("verify-att-a@giftvaly.com", "Att A");
      const B = await mkUser("verify-att-b@giftvaly.com", "Att B");
      const C = await mkUser("verify-att-c@giftvaly.com", "Att C");

      // ---------- check-in / check-out (§11) ----------
      console.log("\nCheck-in / check-out (§11):");
      const day = "2026-05-11"; // a Monday (workday)
      const inLate = new Date(`${day}T10:20:00+06:00`); // after 10:15 → LATE
      const row = await checkIn(A.id, inLate, tx);
      check("check-in creates a row", !!row.id);
      check("late arrival auto-flagged LATE", row.status === "LATE", row.status);
      check("check-in timestamp stored", row.checkInAt?.toISOString() === inLate.toISOString());

      const todayRow = await getTodayAttendance(A.id, inLate, tx);
      check("today's row is found", todayRow?.id === row.id);

      let doubleIn = false;
      try {
        await checkIn(A.id, new Date(`${day}T10:40:00+06:00`), tx);
      } catch {
        doubleIn = true;
      }
      check("second check-in rejected", doubleIn);

      // Who's in today — A is in, still in office.
      const inSnap = await whoIsInToday(inLate, tx);
      const aEntry = inSnap.entries.find((e) => e.userId === A.id);
      check("who's-in lists A", !!aEntry, JSON.stringify(inSnap.entries.map((e) => e.userId)));
      check("A shown still in office", aEntry?.stillIn === true);
      check("still-in count = 1", inSnap.stillInCount === 1, `got ${inSnap.stillInCount}`);

      const outAt = new Date(`${day}T18:20:00+06:00`);
      const outRow = await checkOut(A.id, outAt, tx);
      check("check-out stored", outRow.checkOutAt?.toISOString() === outAt.toISOString());

      let doubleOut = false;
      try {
        await checkOut(A.id, new Date(`${day}T19:00:00+06:00`), tx);
      } catch {
        doubleOut = true;
      }
      check("second check-out rejected", doubleOut);

      let outNoIn = false;
      try {
        await checkOut(B.id, inLate, tx);
      } catch {
        outNoIn = true;
      }
      check("check-out without check-in rejected", outNoIn);

      const afterOut = await whoIsInToday(outAt, tx);
      check("A now counted as left", afterOut.leftCount === 1 && afterOut.stillInCount === 0);

      // ---------- leave request → approval (§11) ----------
      console.log("\nLeave flow (§11):");
      const { id: leaveId } = await createLeaveRequest(
        B.id,
        { fromDate: "2026-05-06", toDate: "2026-05-07", reason: "Family event" },
        tx
      );
      check("leave request created (PENDING)", !!leaveId);

      await decideLeaveRequest(leaveId, true, A.id, new Date(), tx);
      const approved = await tx.leaveRequest.findUniqueOrThrow({ where: { id: leaveId } });
      check("leave approved", approved.status === "APPROVED");
      check("approver recorded", approved.approvedBy === A.id);

      let doubleDecide = false;
      try {
        await decideLeaveRequest(leaveId, false, A.id, new Date(), tx);
      } catch {
        doubleDecide = true;
      }
      check("cannot decide an already-approved request", doubleDecide);

      // A pending request the requester withdraws.
      const { id: pendId } = await createLeaveRequest(
        C.id,
        { fromDate: "2026-05-20", toDate: "2026-05-20", reason: "Personal" },
        tx
      );
      let notYours = false;
      try {
        await cancelLeaveRequest(pendId, A.id, tx);
      } catch {
        notYours = true;
      }
      check("cannot withdraw someone else's request", notYours);
      await cancelLeaveRequest(pendId, C.id, tx);
      const gone = await tx.leaveRequest.findUnique({ where: { id: pendId } });
      check("own pending request withdrawn", gone === null);

      // ---------- R10 monthly sheet: present/late/leave/absent (§11) ----------
      console.log("\nMonthly sheet R10 (§11):");
      // Give B a present + a late day so counts have variety.
      await checkIn(B.id, new Date("2026-05-04T09:50:00+06:00"), tx); // Mon → PRESENT
      await checkIn(B.id, new Date("2026-05-05T10:40:00+06:00"), tx); // Tue → LATE

      // `now` in June → every May day is strictly in the past (fully resolved).
      const afterMonth = new Date("2026-06-02T12:00:00+06:00");
      const sheet = await buildEmployeeMonthlySheet(B.id, "2026-05", afterMonth, tx);
      const cell = (d: string) => sheet.days.find((x) => x.date === d)!;
      check("05-04 PRESENT", cell("2026-05-04").status === "PRESENT", cell("2026-05-04").status);
      check("05-05 LATE", cell("2026-05-05").status === "LATE", cell("2026-05-05").status);
      check("05-06 LEAVE (approved)", cell("2026-05-06").status === "LEAVE", cell("2026-05-06").status);
      check("05-07 LEAVE (approved)", cell("2026-05-07").status === "LEAVE", cell("2026-05-07").status);
      check("05-01 Friday OFF", cell("2026-05-01").status === "OFF", cell("2026-05-01").status);
      // A past workday (Tue) B never marked and wasn't on leave → ABSENT.
      check("05-12 ABSENT (unmarked workday)", cell("2026-05-12").status === "ABSENT", cell("2026-05-12").status);

      check("counts: present = 1", sheet.counts.present === 1, `got ${sheet.counts.present}`);
      check("counts: late = 1", sheet.counts.late === 1, `got ${sheet.counts.late}`);
      check("counts: leave = 2", sheet.counts.leave === 2, `got ${sheet.counts.leave}`);
      check("counts: daysPresent = present+late+half", sheet.counts.daysPresent === 2, `got ${sheet.counts.daysPresent}`);
      // Self-consistency: every workday resolved to present/absent/leave.
      check(
        "absent = workdays − daysPresent − leave (all workdays resolved)",
        sheet.counts.absent === sheet.counts.workdays - sheet.counts.daysPresent - sheet.counts.leave,
        `absent=${sheet.counts.absent} workdays=${sheet.counts.workdays} present=${sheet.counts.daysPresent} leave=${sheet.counts.leave}`
      );

      // A's sheet: one worked day (May 11) with hours ~8.
      const aSheet = await buildEmployeeMonthlySheet(A.id, "2026-05", afterMonth, tx);
      const a11 = aSheet.days.find((x) => x.date === "2026-05-11")!;
      check("A 05-11 LATE with worked hours ≈ 8", a11.status === "LATE" && a11.workedHours === 8, `${a11.status} ${a11.workedHours}`);
      check("A total work hours = 8", aSheet.counts.totalWorkHours === 8, `got ${aSheet.counts.totalWorkHours}`);

      // ---------- team summary (§11) ----------
      console.log("\nTeam summary (§11):");
      const summary = await buildTeamMonthlySummary("2026-05", afterMonth, tx);
      const bRow = summary.rows.find((r) => r.userId === B.id);
      check("summary includes B", !!bRow);
      check("summary B present = 1, late = 1, leave = 2", bRow?.counts.present === 1 && bRow?.counts.late === 1 && bRow?.counts.leave === 2, JSON.stringify(bRow?.counts));

      throw new Error(ROLLBACK);
    }, { timeout: 60000 });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
