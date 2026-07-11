// Reports verification (SPEC §12) — R1 Sales, R3 Team performance, R11
// Cancelled/Returned, R12 Customer report, plus the shared report-PDF renderer.
// Read-only against the seeded dev DB: every builder is cross-checked against
// direct Prisma aggregates under each role scope (SE own / TL team / all), and
// §10 target confidentiality is asserted per viewer. Run: npm run verify:reports
import { PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import {
  buildSalesReport,
  buildCancelledReport,
  buildCustomerReport,
} from "../lib/order-reports";
import { buildTeamPerformanceReport } from "../lib/team-performance";
import { renderReportPdf } from "../lib/report-pdf";
import { NON_SALE_STATUSES } from "../lib/order-constants";
import type { OrderStatus, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

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

const round2 = (n: number) => Math.round(n * 100) / 100;
const LOST = NON_SALE_STATUSES as unknown as OrderStatus[];

async function main() {
  console.log("Reports verification — SPEC §12 (R1 / R3 / R11 / R12 + PDF)\n");

  const [sanjoy, partho, sakib, admin] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { email: "sanjoy@giftvaly.com" },
      select: { id: true, teamId: true, name: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { email: "partho@giftvaly.com" },
      select: { id: true, teamId: true, name: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { email: "sakib@giftvaly.com" },
      select: { id: true, teamId: true, name: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { email: "mh.neshad39@gmail.com" },
      select: { id: true, name: true },
    }),
  ]);

  // Wide range covering all seeded orders (created up to ~25 days ago).
  const from = new Date(Date.now() - 60 * 86_400_000);
  const to = new Date(Date.now() + 86_400_000);
  const inRange = { createdAt: { gte: from, lte: to } };

  const ownWhere: Prisma.OrderWhereInput = { salesExecutiveId: sanjoy.id };
  const teamWhere: Prisma.OrderWhereInput = {
    OR: [
      { salesExecutiveId: sakib.id },
      { teamId: { in: sakib.teamId ? [sakib.teamId] : [] } },
    ],
  };

  // ============ R1 — Sales report ============
  console.log("R1 — Sales report:");
  {
    const all = await buildSalesReport({ from, to, orderWhere: {} });
    const [totalDb, saleAgg, deliveredDb, lostDb] = await Promise.all([
      prisma.order.count({ where: inRange }),
      prisma.order.aggregate({
        where: { ...inRange, status: { notIn: LOST } },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      prisma.order.count({
        where: { ...inRange, status: { in: ["DELIVERED", "COMPLETED"] } },
      }),
      prisma.order.count({ where: { ...inRange, status: { in: LOST } } }),
    ]);
    check("total orders match DB", all.totalOrders === totalDb, `${all.totalOrders} vs ${totalDb}`);
    check(
      "sales value excludes cancelled/returned/refunded",
      all.salesValue === round2(Number(saleAgg._sum.totalAmount ?? 0)),
      `${all.salesValue} vs ${Number(saleAgg._sum.totalAmount ?? 0)}`
    );
    check("sale order count matches", all.salesOrders === saleAgg._count._all);
    check("delivered count matches", all.delivered.count === deliveredDb);
    check("cancelled bucket = lost statuses", all.cancelled.count === lostDb);
    check(
      "Σ byDay.orders = total orders",
      all.byDay.reduce((s, r) => s + r.orders, 0) === all.totalOrders
    );
    check(
      "Σ bySE.salesValue = sales value",
      round2(all.bySE.reduce((s, r) => s + r.salesValue, 0)) === all.salesValue
    );
    check(
      "Σ byCountry.orders = total orders",
      all.byCountry.reduce((s, r) => s + r.orders, 0) === all.totalOrders
    );
    check(
      "byStatus totals reconcile",
      all.byStatus.reduce((s, r) => s + r.orders, 0) === all.totalOrders
    );
    check(
      "AOV = salesValue ÷ salesOrders",
      all.salesOrders === 0 ||
        all.avgOrderValue === round2(all.salesValue / all.salesOrders)
    );

    // Packages: only from non-lost orders.
    const pkgLines = await prisma.orderItem.findMany({
      where: {
        itemType: "PACKAGE",
        order: { ...inRange, status: { notIn: LOST } },
      },
      select: { qty: true, lineTotal: true },
    });
    check(
      "byPackage qty = package lines of sale orders",
      all.byPackage.reduce((s, r) => s + r.qty, 0) ===
        pkgLines.reduce((s, l) => s + l.qty, 0)
    );

    // Role scopes.
    const own = await buildSalesReport({ from, to, orderWhere: ownWhere });
    const ownDb = await prisma.order.count({
      where: { ...inRange, salesExecutiveId: sanjoy.id },
    });
    check("SE own scope: only own orders", own.totalOrders === ownDb);
    check(
      "SE own scope: bySE has a single SE",
      own.bySE.length <= 1 &&
        (own.bySE.length === 0 || own.bySE[0].key === String(sanjoy.id))
    );

    const team = await buildSalesReport({ from, to, orderWhere: teamWhere });
    const teamDb = await prisma.order.count({
      where: { AND: [inRange, teamWhere] },
    });
    check("TL team scope: team orders only", team.totalOrders === teamDb);
    check(
      "scopes nest: own ≤ team ≤ all",
      own.totalOrders <= team.totalOrders && team.totalOrders <= all.totalOrders
    );

    // seId filter narrows to that SE even under all-scope.
    const filtered = await buildSalesReport({
      from,
      to,
      orderWhere: {},
      seId: partho.id,
    });
    const parthoDb = await prisma.order.count({
      where: { ...inRange, salesExecutiveId: partho.id },
    });
    check("seId filter narrows to the SE", filtered.totalOrders === parthoDb);
  }

  // ============ R11 — Cancelled/Returned analysis ============
  console.log("\nR11 — Cancelled/Returned analysis:");
  {
    const all = await buildCancelledReport({ from, to, orderWhere: {} });
    const [cancelledDb, returnedDb, refundedDb, totalDb] = await Promise.all([
      prisma.order.count({ where: { ...inRange, status: "CANCELLED" } }),
      prisma.order.count({ where: { ...inRange, status: "RETURNED" } }),
      prisma.order.count({ where: { ...inRange, status: "REFUNDED" } }),
      prisma.order.count({ where: inRange }),
    ]);
    check("cancelled count matches DB", all.cancelled.count === cancelledDb);
    check("returned count matches DB", all.returned.count === returnedDb);
    check("refunded count matches DB", all.refunded.count === refundedDb);
    check(
      "lost = cancelled + returned + refunded",
      all.lostCount === cancelledDb + returnedDb + refundedDb
    );
    check(
      "loss rate over all bookings",
      totalDb === 0 || all.lossRatePct === round2((all.lostCount / totalDb) * 100)
    );
    check(
      "lost value = Σ buckets",
      all.lostValue ===
        round2(all.cancelled.value + all.returned.value + all.refunded.value)
    );
    check(
      "byReason covers every lost order",
      all.byReason.reduce((s, r) => s + r.count, 0) === all.lostCount
    );
    check(
      "reason shares sum to ~100%",
      all.lostCount === 0 ||
        Math.abs(all.byReason.reduce((s, r) => s + r.share, 0) - 100) < 1
    );
    check("detail rows = lost orders", all.rows.length === all.lostCount);
    check(
      "seeded cancel reason surfaces",
      all.lostCount === 0 ||
        all.byReason.some((r) => r.reason.includes("recipient travelling"))
    );

    const own = await buildCancelledReport({ from, to, orderWhere: ownWhere });
    check(
      "SE own scope: detail rows all own",
      own.rows.every((r) => r.salesExecutive === sanjoy.name)
    );
    const ownLostDb = await prisma.order.count({
      where: { ...inRange, salesExecutiveId: sanjoy.id, status: { in: LOST } },
    });
    check("SE own scope: lost count matches DB", own.lostCount === ownLostDb);
  }

  // ============ R12 — Customer report ============
  console.log("\nR12 — Customer report:");
  {
    const all = await buildCustomerReport({ orderWhere: {} }); // all time
    const distinct = await prisma.order.groupBy({ by: ["customerId"] });
    check("customer count = distinct order customers", all.totalCustomers === distinct.length);

    const saleAgg = await prisma.order.aggregate({
      where: { status: { notIn: LOST } },
      _sum: { totalAmount: true },
    });
    check(
      "total sales value excludes lost orders",
      all.totalSalesValue === round2(Number(saleAgg._sum.totalAmount ?? 0)),
      `${all.totalSalesValue} vs ${Number(saleAgg._sum.totalAmount ?? 0)}`
    );

    // Repeat = 2+ sale orders; verify against a direct group-by.
    const repeatDb = (
      await prisma.order.groupBy({
        by: ["customerId"],
        where: { status: { notIn: LOST } },
        _count: { _all: true },
      })
    ).filter((g) => g._count._all >= 2);
    check(
      "repeat customers = 2+ sale orders",
      all.repeatCustomers === repeatDb.length,
      `${all.repeatCustomers} vs ${repeatDb.length}`
    );
    check(
      "repeat rows all have 2+ sale orders",
      all.repeatRows.every((r) => r.saleOrders >= 2)
    );
    check(
      "top customers sorted by value",
      all.topCustomers.every(
        (r, i) => i === 0 || all.topCustomers[i - 1].salesValue >= r.salesValue
      )
    );
    check(
      "Σ byCountry.customers = customers",
      all.byCountry.reduce((s, r) => s + r.customers, 0) === all.totalCustomers
    );

    const own = await buildCustomerReport({ orderWhere: ownWhere });
    const ownDistinct = await prisma.order.groupBy({
      by: ["customerId"],
      where: { salesExecutiveId: sanjoy.id },
    });
    check(
      "SE own scope: only own customers",
      own.totalCustomers === ownDistinct.length
    );
  }

  // ============ R3 — Team performance ============
  console.log("\nR3 — Team performance:");
  {
    const monthKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
    })
      .format(new Date())
      .slice(0, 7);

    const mkSession = (u: { id: number; name: string }, role: string) =>
      ({ user: { id: u.id, name: u.name, role } }) as unknown as Session;

    // Admin sees everyone.
    const adminReport = await buildTeamPerformanceReport(
      mkSession(admin, "Admin"),
      ["reports.own", "reports.team", "reports.all"],
      monthKey
    );
    const sellerCount = await prisma.user.count({
      where: {
        isActive: true,
        role: { name: { in: ["SalesExecutive", "TeamLeader"] } },
      },
    });
    check("all scope: every active seller listed", adminReport.rows.length === sellerCount);
    check("all scope includes teams section", adminReport.teams.length >= 1);

    // SE sees only their own row.
    const seReport = await buildTeamPerformanceReport(
      mkSession(sanjoy, "SalesExecutive"),
      ["reports.own"],
      monthKey
    );
    check(
      "own scope: single own row",
      seReport.rows.length === 1 && seReport.rows[0].userId === sanjoy.id
    );
    check("own scope: no teams section", seReport.teams.length === 0);

    // TL sees their team.
    const tlReport = await buildTeamPerformanceReport(
      mkSession(sakib, "TeamLeader"),
      ["reports.own", "reports.team"],
      monthKey
    );
    const teamMembers = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { name: { in: ["SalesExecutive", "TeamLeader"] } },
        OR: [{ id: sakib.id }, { teamId: sakib.teamId }],
      },
      select: { id: true },
    });
    check(
      "team scope: exactly the team's sellers",
      tlReport.rows.length === teamMembers.length &&
        tlReport.rows.every((r) => teamMembers.some((m) => m.id === r.userId))
    );

    // Numbers agree with a direct aggregate for one SE.
    const sanjoyRow = adminReport.rows.find((r) => r.userId === sanjoy.id);
    const start = new Date(`${monthKey}-01T00:00:00+06:00`);
    const agg = await prisma.order.aggregate({
      where: {
        salesExecutiveId: sanjoy.id,
        status: { notIn: LOST },
        createdAt: { gte: start },
      },
      _count: { _all: true },
      _sum: { totalAmount: true },
    });
    check(
      "SE orders match direct aggregate",
      sanjoyRow?.orders === agg._count._all,
      `${sanjoyRow?.orders} vs ${agg._count._all}`
    );
    check(
      "SE sales value matches direct aggregate",
      sanjoyRow?.salesValue === round2(Number(agg._sum.totalAmount ?? 0))
    );

    // §10 confidentiality — the seeded confidential target (TL Sakib).
    const confidential = await prisma.target.findFirst({
      where: { scope: "USER", isConfidential: true },
      select: { userId: true },
    });
    if (confidential?.userId) {
      const subjectId = confidential.userId;
      const adminRow = adminReport.rows.find((r) => r.userId === subjectId);
      check(
        "confidential target visible to Admin",
        !!adminRow?.target && !adminRow.target.hidden
      );

      // A Manager (reports.all, not Admin) must NOT see it.
      const mgr = await prisma.user.findUniqueOrThrow({
        where: { email: "manager@giftvaly.com" },
        select: { id: true, name: true },
      });
      const mgrReport = await buildTeamPerformanceReport(
        mkSession(mgr, "Manager"),
        ["reports.own", "reports.team", "reports.all"],
        monthKey
      );
      const mgrRow = mgrReport.rows.find((r) => r.userId === subjectId);
      check(
        "confidential target hidden from Manager",
        !!mgrRow?.target && mgrRow.target.hidden === true
      );

      // …and the subject themself does see it.
      const subject = await prisma.user.findUniqueOrThrow({
        where: { id: subjectId },
        select: { id: true, name: true },
      });
      const subjReport = await buildTeamPerformanceReport(
        mkSession(subject, "TeamLeader"),
        ["reports.own", "reports.team"],
        monthKey
      );
      const subjRow = subjReport.rows.find((r) => r.userId === subjectId);
      check(
        "confidential target visible to its subject",
        !!subjRow?.target && !subjRow.target.hidden
      );
    } else {
      console.log("  (no confidential target seeded — skipping §10 checks)");
    }
  }

  // ============ Report PDF renderer ============
  console.log("\nReport PDF renderer:");
  {
    const pdf = await renderReportPdf(
      {
        title: "Verification Sample",
        subtitle: "01 Jul 2026 → 11 Jul 2026 · SE: সঞ্জয়",
        landscape: true,
        kpis: [
          { label: "Orders", value: "120" },
          { label: "Sales value", value: "৳4,52,300" },
        ],
        sections: [
          {
            heading: "By day",
            note: "Bangla text + 120 rows to force a page break.",
            headers: ["Date", "Orders", "Sales value (বিক্রয়)"],
            aligns: ["l", "r", "r"],
            rows: Array.from({ length: 120 }, (_, i) => [
              `2026-06-${String((i % 30) + 1).padStart(2, "0")}`,
              i,
              `৳${(i * 1234).toLocaleString("en-IN")}`,
            ]),
          },
          { heading: "Empty section", headers: ["A", "B"], rows: [] },
        ],
      },
      { generatedBy: "verify-reports" }
    );
    check("output is a PDF", pdf.subarray(0, 5).toString() === "%PDF-");
    check("multi-page output has real size", pdf.length > 10_000, `${pdf.length} bytes`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
