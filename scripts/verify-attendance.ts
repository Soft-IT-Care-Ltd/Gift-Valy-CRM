// Attendance & Leave verification (SPEC §11 + CORRECTIONS R10). Drives the pure
// status math, the Dhaka calendar helpers, check-in/out (server-side timestamps
// + auto Late/Half-day flags), the leave request → approval flow, absent/leave
// derivation in the monthly sheet, the team summary, the "who's in today"
// snapshot — and the R10 roster engine: shifts, weekly rosters versioned by
// effective date, late vs a person's OWN shift start, off-days never absent,
// and the office-hours default for anyone without a roster — all inside ONE
// rolled-back transaction (mirrors verify-targets).
import { PrismaClient } from "@prisma/client";
import {
  ATTENDANCE_SETTINGS_KEY,
  DEFAULT_ATTENDANCE_SETTINGS,
  attendanceSettingsToJson,
  deriveCheckInStatus,
  deriveDayPlanStatus,
  isWorkday,
  leaveDays,
  monthDays,
  parseHHMM,
  shiftDayPlan,
  weekdayOfYmd,
  type ShiftDef,
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
  createShift,
  updateShift,
  deleteShift,
  saveRosterWeek,
  loadRosterData,
  resolveUserDayPlan,
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

  // ---------- R10: shift plan math (pure) ----------
  console.log("\nR10 shift plan math:");
  const morningDef: ShiftDef = {
    id: 1,
    name: "Morning",
    startTime: "09:00",
    endTime: "17:00",
    lateAfterMin: 15,
    halfDayAfterMin: 240,
    isActive: true,
  };
  const mPlan = shiftDayPlan(morningDef);
  check(
    "late threshold anchored to the shift's own start (09:00 + 15 = 09:15)",
    mPlan.kind === "WORK" && mPlan.lateMin === 555
  );
  check(
    "half-day threshold relative to shift start (09:00 + 240 = 13:00)",
    mPlan.kind === "WORK" && mPlan.halfMin === 780
  );
  check("09:15 exactly → PRESENT (grace)", deriveDayPlanStatus(555, mPlan) === "PRESENT");
  check("09:16 → LATE vs own shift", deriveDayPlanStatus(556, mPlan) === "LATE");
  check("13:00 → HALF_DAY vs own shift", deriveDayPlanStatus(780, mPlan) === "HALF_DAY");
  check(
    "off-day check-in → PRESENT (an off-day can never be late)",
    deriveDayPlanStatus(900, { kind: "OFF", source: "roster" }) === "PRESENT"
  );

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

      // ---------- R10: shifts + weekly roster (DB) ----------
      console.log("\nR10 shifts & roster:");
      const morning = await createShift(
        {
          name: "Verify Morning",
          startTime: "09:00",
          endTime: "17:00",
          lateAfterMin: 15,
          halfDayAfterMin: 240,
          isActive: true,
        },
        A.id,
        tx
      );
      const evening = await createShift(
        {
          name: "Verify Evening",
          startTime: "14:00",
          endTime: "22:00",
          lateAfterMin: 15,
          halfDayAfterMin: null,
          isActive: true,
        },
        A.id,
        tx
      );
      const mId = morning.id;
      const eId = evening.id;
      check("shifts created", mId > 0 && eId > 0);

      let overnight = false;
      try {
        await createShift(
          {
            name: "Verify Night",
            startTime: "22:00",
            endTime: "06:00",
            lateAfterMin: 15,
            halfDayAfterMin: null,
            isActive: true,
          },
          A.id,
          tx
        );
      } catch {
        overnight = true;
      }
      check("overnight shift rejected (end before start)", overnight);

      const upd = await updateShift(mId, { ...morning, lateAfterMin: 20 }, A.id, tx);
      check("shift update persists", upd.after.lateAfterMin === 20);
      await updateShift(mId, { ...morning, lateAfterMin: 15 }, A.id, tx);

      // D: v1 from May 1 — Morning all week, Friday off; v2 from Sunday May 17 —
      // Evening all week, Tuesday off. History preserved, change applies forward.
      const D = await mkUser("verify-att-d@giftvaly.com", "Att D");
      await saveRosterWeek(
        { userId: D.id, effectiveFrom: "2026-05-01", days: [mId, mId, mId, mId, mId, "OFF", mId] },
        A.id,
        tx
      );
      await saveRosterWeek(
        { userId: D.id, effectiveFrom: "2026-05-17", days: [eId, eId, "OFF", eId, eId, eId, eId] },
        A.id,
        tx
      );

      let badShift = false;
      try {
        await saveRosterWeek(
          { userId: D.id, effectiveFrom: "2026-05-01", days: [999999, mId, mId, mId, mId, "OFF", mId] },
          A.id,
          tx
        );
      } catch {
        badShift = true;
      }
      check("unknown shift in a roster save rejected", badShift);

      const planV1 = await resolveUserDayPlan(D.id, "2026-05-13", tx);
      check("May 13 (Wed) resolves to Morning (v1)", planV1.kind === "WORK" && planV1.shiftId === mId);
      const planV2 = await resolveUserDayPlan(D.id, "2026-05-20", tx);
      check("May 20 (Wed) resolves to Evening (v2 applies from May 17)", planV2.kind === "WORK" && planV2.shiftId === eId);
      const planPre = await resolveUserDayPlan(D.id, "2026-04-29", tx);
      check(
        "before any version → default office-hours fallback",
        planPre.kind === "WORK" && planPre.source === "default" && planPre.shiftId === null
      );

      // ---------- R10: late vs OWN shift start ----------
      console.log("\nR10 late vs own shift:");
      const dLate = await checkIn(D.id, new Date("2026-05-13T09:20:00+06:00"), tx);
      check("09:20 → LATE for Morning-shift D (his late mark is 09:15)", dLate.status === "LATE", dLate.status);
      const cSame = await checkIn(C.id, new Date("2026-05-13T09:20:00+06:00"), tx);
      check("same 09:20 → PRESENT for default-hours C (late after 10:15)", cSame.status === "PRESENT", cSame.status);
      const dHalf = await checkIn(D.id, new Date("2026-05-14T13:05:00+06:00"), tx);
      check("13:05 → HALF_DAY for D (half-day 240 min past his 09:00 start)", dHalf.status === "HALF_DAY", dHalf.status);
      const dEve = await checkIn(D.id, new Date("2026-05-20T14:10:00+06:00"), tx);
      check(
        "after the roster change 14:10 → PRESENT for Evening D (the old global rule would have said half-day)",
        dEve.status === "PRESENT",
        dEve.status
      );

      // Approved leave overlapping a rostered off-day (May 19 is Tue = v2 off).
      const { id: dLeave } = await createLeaveRequest(
        D.id,
        { fromDate: "2026-05-18", toDate: "2026-05-19", reason: "Verify leave" },
        tx
      );
      await decideLeaveRequest(dLeave, true, A.id, new Date(), tx);

      // ---------- R10: roster-aware monthly sheet ----------
      console.log("\nR10 roster-aware sheet:");
      const dSheet = await buildEmployeeMonthlySheet(D.id, "2026-05", afterMonth, tx);
      const dCell = (d: string) => dSheet.days.find((x) => x.date === d)!;
      check("May 8 (Fri) OFF under v1 — off-day never counted absent", dCell("2026-05-08").status === "OFF", dCell("2026-05-08").status);
      check("May 5 (Tue) ABSENT under v1 (rostered workday, no check-in)", dCell("2026-05-05").status === "ABSENT", dCell("2026-05-05").status);
      check("May 19 (Tue) OFF under v2 — the change applies from its effective date", dCell("2026-05-19").status === "OFF", dCell("2026-05-19").status);
      check("May 19 stays OFF though approved leave covers it (off wins)", dCell("2026-05-19").status === "OFF");
      check("May 18 (Mon) LEAVE (approved)", dCell("2026-05-18").status === "LEAVE", dCell("2026-05-18").status);
      check("May 22 (Fri) ABSENT under v2 (Friday became a workday)", dCell("2026-05-22").status === "ABSENT", dCell("2026-05-22").status);
      check("day cell carries the shift name (May 13 → Verify Morning)", dCell("2026-05-13").shiftName === "Verify Morning");
      check("day cell carries the shift name (May 20 → Verify Evening)", dCell("2026-05-20").shiftName === "Verify Evening");
      check("off = 3 v1 Fridays + 2 v2 Tuesdays = 5", dSheet.counts.off === 5, `got ${dSheet.counts.off}`);
      check("workdays follow the roster (31 − 5 = 26)", dSheet.counts.workdays === 26, `got ${dSheet.counts.workdays}`);
      check(
        "absent = workdays − daysPresent − leave (off-days excluded)",
        dSheet.counts.absent === dSheet.counts.workdays - dSheet.counts.daysPresent - dSheet.counts.leave,
        JSON.stringify(dSheet.counts)
      );
      check("absent = 26 − 3 present − 1 leave = 22", dSheet.counts.absent === 22, `got ${dSheet.counts.absent}`);

      // ---------- R10: who's-in off bucket ----------
      console.log("\nR10 who's in today:");
      const offSnap = await whoIsInToday(new Date("2026-05-19T11:00:00+06:00"), tx);
      check("D listed under Off today (rostered Tue off)", offSnap.offToday.some((u) => u.userId === D.id));
      check("D not among checked-in entries", !offSnap.entries.some((en) => en.userId === D.id));
      check("off wins over leave — D not doubled under On leave", !offSnap.onLeave.some((u) => u.userId === D.id));

      // ---------- R10: history + guards ----------
      console.log("\nR10 history & guards:");
      const rosterBefore = await loadRosterData(tx, [D.id]);
      check("both versions preserved (history)", (rosterBefore.versionsByUser.get(D.id) ?? []).length === 2);
      await saveRosterWeek(
        { userId: D.id, effectiveFrom: "2026-05-17", days: [null, null, null, null, null, null, null] },
        A.id,
        tx
      );
      const rosterAfter = await loadRosterData(tx, [D.id]);
      check("an all-default save removes that version", (rosterAfter.versionsByUser.get(D.id) ?? []).length === 1);
      const planReverted = await resolveUserDayPlan(D.id, "2026-05-20", tx);
      check("May 20 falls back to v1 Morning again", planReverted.kind === "WORK" && planReverted.shiftId === mId);

      let usedDelete = false;
      try {
        await deleteShift(mId, tx);
      } catch {
        usedDelete = true;
      }
      check("a shift referenced by roster history can't be deleted", usedDelete);
      const temp = await createShift(
        {
          name: "Verify Temp",
          startTime: "10:00",
          endTime: "18:00",
          lateAfterMin: 10,
          halfDayAfterMin: null,
          isActive: true,
        },
        A.id,
        tx
      );
      await deleteShift(temp.id, tx);
      const tempGone = await tx.shift.findUnique({ where: { id: temp.id } });
      check("an unused shift deletes cleanly", tempGone === null);

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
