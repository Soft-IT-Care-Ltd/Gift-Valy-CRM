// Lead Management verification (SPEC §3). Drives lead entry, duplicate detection,
// lost-reason rules, follow-up buckets, auto-convert (lead → order links + flips
// to CONVERTED, unique so it can't convert twice), reassignment, bulk daily
// counts and the R2 report — all inside ONE rolled-back transaction.
import { PrismaClient, Prisma } from "@prisma/client";
import {
  findDuplicates,
  buildFollowUps,
  resolveInterested,
  validateLostReason,
  canEditLead,
} from "../lib/leads";
import { buildLeadReport } from "../lib/reports";

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

// A Dhaka-anchored timestamp offset from today (days), at a given hour.
const dhakaDateStr = (offsetDays: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(
    new Date(Date.now() + offsetDays * 86_400_000)
  );
const at = (offsetDays: number, hour: number) =>
  new Date(`${dhakaDateStr(offsetDays)}T${String(hour).padStart(2, "0")}:00:00+06:00`);
// @db.Date value for a Dhaka day — UTC-midnight, NOT a +06 instant (which
// Prisma would truncate to the previous UTC day).
const dateOnly = (offsetDays: number) => new Date(`${dhakaDateStr(offsetDays)}T00:00:00.000Z`);

async function main() {
  console.log("Lead management verification — SPEC §3\n");

  const sanjoy = await prisma.user.findUniqueOrThrow({
    where: { email: "sanjoy@giftvaly.com" },
    select: { id: true, teamId: true },
  });
  const partho = await prisma.user.findUniqueOrThrow({
    where: { email: "partho@giftvaly.com" },
    select: { id: true, teamId: true },
  });
  const product = await prisma.product.findFirstOrThrow({ select: { id: true, name: true } });
  const pkg = await prisma.package.findFirstOrThrow({ select: { id: true, name: true } });
  const customer = await prisma.customer.findFirstOrThrow({ select: { id: true } });

  const ownScope = { assignedTo: sanjoy.id };
  const teamScope = {
    OR: [{ assignedTo: sanjoy.id }, { teamId: { in: [sanjoy.teamId!] } }],
  };

  // ---- pure-logic checks (no DB) ----
  console.log("Lost-reason rule (§3.1):");
  check("LOST without reason is rejected", validateLostReason("LOST", null) !== null);
  check("LOST with reason is accepted", validateLostReason("LOST", "PRICE") === null);
  check("Non-LOST needs no reason", validateLostReason("NEGOTIATING", null) === null);

  console.log("\nEdit authorization (§3.2 / SOP):");
  check(
    "assignee may edit own lead",
    canEditLead({ assignedTo: sanjoy.id }, { user: { id: sanjoy.id } } as never, ["leads.view_own"])
  );
  check(
    "non-assignee without leads.edit may not",
    !canEditLead({ assignedTo: partho.id }, { user: { id: sanjoy.id } } as never, ["leads.view_own"])
  );
  check(
    "leads.edit may edit any visible lead",
    canEditLead({ assignedTo: partho.id }, { user: { id: sanjoy.id } } as never, ["leads.edit"])
  );

  try {
    await prisma.$transaction(async (tx) => {
      // ---- interested-in resolution (§3.1) ----
      const interested = await resolveInterested(tx, [
        { itemType: "PRODUCT", id: product.id },
        { itemType: "PACKAGE", id: pkg.id },
        { itemType: "PRODUCT", id: 999_999 }, // unknown → dropped
      ]);
      console.log("\nInterested-in resolution:");
      check("resolves names, drops unknowns", interested.length === 2, `got ${interested.length}`);
      check("name snapshot from catalog", interested[0].name === product.name);

      // Report is computed as a DELTA against this baseline — the rolled-back tx
      // still sees committed seed leads, so absolute counts aren't isolated.
      const reportRange = {
        from: dateOnly(-30),
        to: dateOnly(1),
        leadWhere: ownScope,
        dailyCountWhere: { userId: sanjoy.id },
      };
      const before = await buildLeadReport(reportRange, tx);

      // ---- create leads ----
      const phone = "+9665599001122";
      const openLead = await tx.lead.create({
        data: {
          leadDate: dateOnly(-1),
          source: "FACEBOOK_AD",
          campaignName: "Verify Campaign",
          customerName: "Verify Lead",
          country: "KSA",
          whatsappNumber: phone,
          interestedIn: interested as unknown as Prisma.InputJsonValue,
          status: "NEGOTIATING",
          followUpAt: at(-2, 12), // overdue
          assignedTo: sanjoy.id,
          teamId: sanjoy.teamId,
        },
      });
      const todayLead = await tx.lead.create({
        data: {
          leadDate: dateOnly(0),
          source: "MESSENGER",
          customerName: "Today FollowUp",
          whatsappNumber: "+9665599003344",
          interestedIn: [] as unknown as Prisma.InputJsonValue,
          status: "CONTACTED",
          followUpAt: at(0, 14), // today
          assignedTo: sanjoy.id,
          teamId: sanjoy.teamId,
        },
      });
      const lostLead = await tx.lead.create({
        data: {
          leadDate: dateOnly(-3),
          source: "INSTAGRAM",
          whatsappNumber: "+9665599005566",
          interestedIn: [] as unknown as Prisma.InputJsonValue,
          status: "LOST",
          lostReason: "PRICE",
          assignedTo: sanjoy.id,
          teamId: sanjoy.teamId,
        },
      });
      // A partho lead in the same team — for scope checks.
      await tx.lead.create({
        data: {
          leadDate: dateOnly(-1),
          source: "WHATSAPP",
          whatsappNumber: "+9665599007788",
          interestedIn: [] as unknown as Prisma.InputJsonValue,
          status: "NEW",
          assignedTo: partho.id,
          teamId: partho.teamId,
        },
      });

      // ---- duplicate detection (§3.1) ----
      const dup = await findDuplicates(phone, ownScope, tx);
      console.log("\nDuplicate detection:");
      check("finds the existing lead by phone", dup.leads.some((l) => l.id === openLead.id));
      const noDup = await findDuplicates("+8801000000000", ownScope, tx);
      check("no false positive for a fresh number", noDup.leads.length === 0);

      // ---- follow-up buckets (§3.2) ----
      const fu = await buildFollowUps(ownScope, tx);
      console.log("\nFollow-up reminders:");
      check("overdue lead flagged", fu.overdue.some((l) => l.id === openLead.id), `overdue=${fu.overdueCount}`);
      check("today's follow-up counted", fu.today.some((l) => l.id === todayLead.id), `today=${fu.todayCount}`);
      check("lost lead never in reminders", !fu.overdue.concat(fu.today).some((l) => l.id === lostLead.id));

      // ---- scope (§2.2) ----
      const ownCount = await tx.lead.count({ where: ownScope });
      const teamCount = await tx.lead.count({ where: teamScope });
      console.log("\nScope:");
      check("team scope sees more than own", teamCount > ownCount, `own=${ownCount} team=${teamCount}`);

      // ---- reassignment (§3.2) ----
      await tx.lead.update({
        where: { id: openLead.id },
        data: { assignedTo: partho.id, teamId: partho.teamId },
      });
      const reassigned = await tx.lead.findUniqueOrThrow({ where: { id: openLead.id } });
      console.log("\nReassignment:");
      check("lead moved to new assignee", reassigned.assignedTo === partho.id);
      // move it back for the conversion test
      await tx.lead.update({
        where: { id: openLead.id },
        data: { assignedTo: sanjoy.id, teamId: sanjoy.teamId },
      });

      // ---- auto-convert (§3.2) ----
      const order = await tx.order.create({
        data: {
          orderNo: "GV-TEST-9001",
          leadId: openLead.id,
          customerId: customer.id,
          recipientName: "Recipient",
          recipientPhoneBd: "+8801700000000",
          deliveryAddress: "Test address, Dhaka",
          district: "Dhaka",
          thana: "Gulshan",
          subtotal: 1000,
          totalAmount: 1000,
          dueAmount: 1000,
          status: "CONFIRMED",
          salesExecutiveId: sanjoy.id,
          teamId: sanjoy.teamId,
        },
      });
      await tx.lead.update({
        where: { id: openLead.id },
        data: { status: "CONVERTED" },
      });
      const converted = await tx.lead.findUniqueOrThrow({
        where: { id: openLead.id },
        include: { convertedOrder: { select: { id: true, orderNo: true } } },
      });
      console.log("\nAuto-convert (lead → order):");
      check("order carries lead_id", order.leadId === openLead.id);
      check("lead flipped to CONVERTED", converted.status === "CONVERTED");
      check("convertedOrder back-relation resolves", converted.convertedOrder?.id === order.id);

      // The order route's pre-check (findUnique on lead_id) is what blocks a
      // second conversion — assert it now sees the existing order. The DB also
      // enforces this with a UNIQUE constraint on orders.lead_id as a backstop.
      const existingForLead = await tx.order.findUnique({
        where: { leadId: openLead.id },
        select: { orderNo: true },
      });
      check(
        "re-convert guard: lead already linked to an order",
        existingForLead?.orderNo === "GV-TEST-9001",
        `got ${existingForLead?.orderNo ?? "none"}`
      );

      // ---- bulk daily counts (§3.1) ----
      await tx.leadDailyCount.create({
        data: { date: dateOnly(-1), userId: sanjoy.id, source: "FACEBOOK_AD", campaignName: "Verify Campaign", count: 20 },
      });
      const dcCount = await tx.leadDailyCount.count({ where: { userId: sanjoy.id } });
      console.log("\nBulk daily counts:");
      check("daily count stored", dcCount >= 1);

      // ---- R2 report (§3.2) — assert deltas vs. baseline ----
      const after = await buildLeadReport(reportRange, tx);
      console.log("\nR2 lead report (delta vs. baseline):");
      // Added: openLead(CONVERTED) + todayLead(CONTACTED) + lostLead(LOST) = 3.
      check("counts the 3 new detailed leads", after.detailedCount - before.detailedCount === 3, `Δ${after.detailedCount - before.detailedCount}`);
      // CORRECTIONS Leads §6 — the headline total combines detailed + bulk:
      // 3 detailed + 20 bulk added since the baseline.
      check("combined total = detailed + bulk (Δ23)", after.totalLeads - before.totalLeads === 23, `Δ${after.totalLeads - before.totalLeads}`);
      // …and per-day too: yesterday gained 1 detailed (openLead) + 20 bulk.
      const dayKey = dhakaDateStr(-1);
      const dayDelta =
        (after.byDate.find((r) => r.key === dayKey)?.total ?? 0) -
        (before.byDate.find((r) => r.key === dayKey)?.total ?? 0);
      check("byDate folds bulk into the same day (Δ21)", dayDelta === 21, `Δ${dayDelta}`);
      check("counts the new conversion", after.converted - before.converted === 1, `Δ${after.converted - before.converted}`);
      check("counts the new lost lead", after.lost - before.lost === 1, `Δ${after.lost - before.lost}`);
      check(
        "conversion % = converted / total",
        after.conversionPct === Math.round((after.converted / after.totalLeads) * 10000) / 100,
        `got ${after.conversionPct}`
      );
      check("lost-reason breakdown present", after.lostReasons.some((r) => r.reason === "PRICE"));
      check("bulk count folded in (+20)", after.bulkCount - before.bulkCount === 20, `Δ${after.bulkCount - before.bulkCount}`);

      throw new Error(ROLLBACK);
    },
    { timeout: 60000 });
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
