// Owner Dashboard verification (SPEC §13 + CORRECTIONS C10 §6a/§6c). Exercises
// the whole data aggregator against the live demo DB for every window type
// (today / week / month / custom) and both cost-visibility modes, asserting the
// widget invariants — funnel monotonicity, MTD-vs-last-month alignment,
// dues/COD snapshots, leaderboard ordering, country-share totals, that cost/
// profit fields are withheld when showCosts is false, and that every Snapshot
// KPI matches a DIRECT DB query for the same range (§6c). Mostly read-only; the
// §6a fallback check creates one sentinel order (VERIFY-DASH-6A) and deletes it
// again in a finally. Run: npx tsx scripts/verify-dashboard.ts
import { PrismaClient } from "@prisma/client";
import {
  resolveDashWindow,
  buildOwnerDashboard,
  buildFunnel,
} from "../lib/dashboard";
import { dhakaYmd } from "../lib/pnl";
import {
  EXCLUDED_SALE_STATUSES,
  dhakaDateBound,
} from "../lib/order-constants";

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

async function main() {
  // ── window resolution ──
  console.log("\nWindow resolution");
  const today = resolveDashWindow({ range: "today" });
  const week = resolveDashWindow({ range: "week" });
  const month = resolveDashWindow({ range: "month" });
  const custom = resolveDashWindow({
    range: "custom",
    from: "2026-06-01",
    to: "2026-06-30",
  });
  check("today is a single Dhaka day", today.singleDay && today.range === "today");
  check(
    "week spans 7 Dhaka days",
    Math.round((today.to.getTime() - week.from.getTime()) / 86_400_000) === 7,
    `got ${(today.to.getTime() - week.from.getTime()) / 86_400_000}`
  );
  check("month starts on the 1st", month.fromYmd.endsWith("-01"), month.fromYmd);
  check(
    "custom respects explicit bounds",
    custom.fromYmd === "2026-06-01" && custom.toYmd === "2026-06-30"
  );
  check(
    "custom swaps reversed bounds",
    resolveDashWindow({ range: "custom", from: "2026-06-30", to: "2026-06-01" })
      .fromYmd === "2026-06-01"
  );
  check(
    "bad range falls back to today",
    resolveDashWindow({ range: "bogus" }).range === "today"
  );

  // ── full aggregate (Admin lens: showCosts true) ──
  console.log("\nOwner dashboard — month window, showCosts=true");
  const d = await buildOwnerDashboard(month, { showCosts: true });

  check("money.sales ≥ 0", d.money.sales >= 0, String(d.money.sales));
  check(
    "estimated profit = sales − costs",
    Math.abs(d.money.net - (d.money.sales - d.money.costs)) < 0.01,
    `${d.money.net} vs ${d.money.sales - d.money.costs}`
  );

  // Funnel must be monotonically non-increasing (confirmed ≥ packed ≥ … ).
  const f = d.funnel.map((s) => s.count);
  check(
    "funnel is monotonic (confirmed ≥ packed ≥ shipped ≥ delivered)",
    f.every((v, i) => i === 0 || v <= f[i - 1]),
    f.join(" ≥ ")
  );
  check("funnel has the 4 lifecycle stages", d.funnel.length === 4);

  // MTD-vs-last-month cumulative series aligned to the same day axis.
  check(
    "MTD & last-month series share one label axis",
    d.month.thisCumulative.length === d.month.labels.length &&
      d.month.lastCumulative.length === d.month.labels.length
  );
  check(
    "MTD cumulative is non-decreasing",
    d.month.thisCumulative.every((v, i) => i === 0 || v >= d.month.thisCumulative[i - 1])
  );
  check(
    "MTD sales matches the cumulative endpoint",
    Math.abs(
      d.month.mtdSales - (d.month.thisCumulative.at(-1) ?? 0)
    ) < 0.01,
    `${d.month.mtdSales} vs ${d.month.thisCumulative.at(-1)}`
  );

  check(
    "dues snapshot ≥ 0 with matching order count",
    d.dues.totalOutstanding >= 0 && d.dues.orderCount >= 0
  );
  check(
    "COD pending is a {count, amount} snapshot",
    typeof d.codPending.count === "number" && typeof d.codPending.amount === "number"
  );

  check(
    "leaderboard sorted by amount rank",
    d.leaderboard.every((r, i) => i === 0 || r.amountRank >= d.leaderboard[i - 1].amountRank)
  );
  check("leaderboard capped at 6", d.leaderboard.length <= 6);

  check(
    "leads conversion = converted / total",
    d.leads.conversionPct === null ||
      Math.abs(
        d.leads.conversionPct - (d.leads.converted / d.leads.total) * 100
      ) < 0.11
  );

  check(
    "country shares sum to ~100% (or 0 when no sales)",
    d.countries.length === 0 ||
      Math.abs(d.countries.reduce((s, c) => s + c.share, 0) - 100) < 1.5,
    d.countries.map((c) => `${c.country}:${c.share}`).join(" ")
  );
  check(
    "country sales sorted descending",
    d.countries.every((c, i) => i === 0 || c.sales <= d.countries[i - 1].sales)
  );

  check("30-day trend has ≤ 30 points", d.trend30.points.length <= 30 && d.trend30.points.length > 0);
  check("stock value present when showCosts", d.inventory.stockValue !== null);
  check("expense split present when showCosts", d.expenseSplit !== null);

  // ── Snapshot KPI strip (CORRECTIONS Dashboard §1–§7) ──
  console.log("\nSnapshot KPIs (CORRECTIONS Dashboard §1–§7)");
  const s = d.snapshot;
  check(
    "§1 snapshot leads == combined lead total",
    s.leads === d.leads.total,
    `${s.leads} vs ${d.leads.total}`
  );
  check(
    "§2 snapshot orders == money.orders (in-range count)",
    s.orders === d.money.orders,
    `${s.orders} vs ${d.money.orders}`
  );
  // Delivered is keyed by DELIVERY date: shipment.delivered_at in range, and
  // for delivered orders missing that stamp (manual moves / no shipment row)
  // the order_status_history → DELIVERED timestamp (C10 §6a fallback).
  // Independent of the funnel's created-in-range stage view. Recompute directly.
  const delivRows = await prisma.order.findMany({
    where: {
      status: { in: ["DELIVERED", "COMPLETED"] },
      deletedAt: null,
      OR: [
        { shipment: { deliveredAt: { gte: month.from, lte: month.to } } },
        {
          OR: [{ shipment: { is: null } }, { shipment: { deliveredAt: null } }],
          statusHistory: {
            some: {
              toStatus: "DELIVERED",
              at: { gte: month.from, lte: month.to },
            },
          },
        },
      ],
    },
    select: { totalAmount: true },
  });
  const expDelivCount = delivRows.length;
  const expDelivAmount =
    Math.round(delivRows.reduce((sum, o) => sum + Number(o.totalAmount), 0) * 100) / 100;
  check(
    "§3 delivered counts orders by delivery date (stamp, else history) in range",
    s.delivered.count === expDelivCount &&
      Math.abs(s.delivered.amount - expDelivAmount) < 0.01,
    `snapshot ${s.delivered.count}/${s.delivered.amount} vs recompute ${expDelivCount}/${expDelivAmount}`
  );
  check(
    "§3 delivered {count, amount} both ≥ 0",
    s.delivered.count >= 0 && s.delivered.amount >= 0,
    `${s.delivered.count} / ${s.delivered.amount}`
  );
  check(
    "§4 advance collection {count, amount} both ≥ 0",
    s.advanceCollection.count >= 0 && s.advanceCollection.amount >= 0,
    `${s.advanceCollection.count} / ${s.advanceCollection.amount}`
  );
  check(
    "§5 total collection == advance + COD + post-MFS",
    Math.abs(
      s.collection.total -
        (s.collection.advance + s.collection.cod + s.collection.postMfs)
    ) < 0.01,
    `${s.collection.total} vs ${
      s.collection.advance + s.collection.cod + s.collection.postMfs
    }`
  );
  check(
    "§5 advance line ≥ §4 advance-only amount (line = ADVANCE + PARTIAL)",
    s.collection.advance >= s.advanceCollection.amount - 0.01,
    `${s.collection.advance} vs ${s.advanceCollection.amount}`
  );
  check(
    "§7 draft orders {count, amount} both ≥ 0",
    s.drafts.count >= 0 && s.drafts.amount >= 0,
    `${s.drafts.count} / ${s.drafts.amount}`
  );
  check("§6 courierEnabled is a boolean", typeof s.courierEnabled === "boolean");

  // ── C10 §6c — every snapshot widget vs a DIRECT DB query, same range ──
  // These bypass the aggregator entirely (raw PrismaClient, no lib helpers
  // beyond shared constants), so a regression inside buildOwnerDashboard's
  // pipeline can't hide behind internal consistency. The raw client has no
  // trash auto-filter, hence the explicit deletedAt: null.
  console.log("\nSnapshot widgets vs direct DB queries (C10 §6c)");
  const [dbLeadsDetailed, dbLeadsBulk, dbOrders, dbDrafts, dbPayments] =
    await Promise.all([
      prisma.lead.count({
        where: { createdAt: { gte: month.from, lte: month.to } },
      }),
      prisma.leadDailyCount.aggregate({
        _sum: { count: true },
        where: {
          date: {
            gte: dhakaDateBound(month.from),
            lte: dhakaDateBound(month.to),
          },
        },
      }),
      prisma.order.count({
        where: {
          createdAt: { gte: month.from, lte: month.to },
          status: { notIn: EXCLUDED_SALE_STATUSES },
          deletedAt: null,
        },
      }),
      prisma.order.aggregate({
        where: {
          createdAt: { gte: month.from, lte: month.to },
          status: "DRAFT",
          deletedAt: null,
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.payment.groupBy({
        by: ["type"],
        where: {
          paymentDate: { gte: month.from, lte: month.to },
          isRejected: false,
          order: { deletedAt: null },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);
  const dbLeads = dbLeadsDetailed + (dbLeadsBulk._sum.count ?? 0);
  check(
    "§1 leads widget == direct detailed + bulk count",
    s.leads === dbLeads,
    `widget ${s.leads} vs DB ${dbLeads}`
  );
  check(
    "§2 orders widget == direct non-lost non-draft count",
    s.orders === dbOrders,
    `widget ${s.orders} vs DB ${dbOrders}`
  );
  const payDb = (t: string) => {
    const g = dbPayments.find((p) => p.type === t);
    return {
      amount: Number(g?._sum.amount ?? 0),
      count: g?._count._all ?? 0,
    };
  };
  const dbAdv = payDb("ADVANCE");
  check(
    "§4 advance widget == direct ADVANCE payment aggregate",
    s.advanceCollection.count === dbAdv.count &&
      Math.abs(s.advanceCollection.amount - dbAdv.amount) < 0.01,
    `widget ${s.advanceCollection.count}/${s.advanceCollection.amount} vs DB ${dbAdv.count}/${dbAdv.amount}`
  );
  const dbCollAdvance = dbAdv.amount + payDb("PARTIAL").amount;
  const dbCollCod = payDb("COD_COURIER").amount;
  const dbCollMfs = payDb("POST_DELIVERY_MFS").amount;
  check(
    "§5 collection lines == direct per-type sums (advance/COD/post-MFS)",
    Math.abs(s.collection.advance - dbCollAdvance) < 0.01 &&
      Math.abs(s.collection.cod - dbCollCod) < 0.01 &&
      Math.abs(s.collection.postMfs - dbCollMfs) < 0.01,
    `widget ${s.collection.advance}/${s.collection.cod}/${s.collection.postMfs} vs DB ${dbCollAdvance}/${dbCollCod}/${dbCollMfs}`
  );
  check(
    "§5 collection total == direct grand total",
    Math.abs(s.collection.total - (dbCollAdvance + dbCollCod + dbCollMfs)) <
      0.01,
    `widget ${s.collection.total} vs DB ${dbCollAdvance + dbCollCod + dbCollMfs}`
  );
  check(
    "§7 drafts widget == direct DRAFT count + amount",
    s.drafts.count === dbDrafts._count &&
      Math.abs(s.drafts.amount - Number(dbDrafts._sum.totalAmount ?? 0)) < 0.01,
    `widget ${s.drafts.count}/${s.drafts.amount} vs DB ${dbDrafts._count}/${Number(
      dbDrafts._sum.totalAmount ?? 0
    )}`
  );

  // ── C10 §6a — delivered-without-stamp falls back to history timestamp ──
  // A DELIVERED order with NO shipment.delivered_at (manual override, no
  // shipment row) must still count in the Delivered widget via its
  // order_status_history DELIVERED entry. Proven live: create such an order
  // stamped now, rebuild the today window, expect count +1 / amount +total,
  // then remove the temp row (cascade takes the history entry with it).
  console.log("\nDelivered fallback to status history (C10 §6a)");
  const SENTINEL_NO = "VERIFY-DASH-6A";
  const seedIds = await prisma.$transaction(async (tx) => {
    const cust = await tx.customer.findFirstOrThrow({ select: { id: true } });
    const admin = await tx.user.findFirstOrThrow({
      where: { role: { name: "Admin" } },
      select: { id: true },
    });
    return { customerId: cust.id, userId: admin.id };
  });
  await prisma.order.deleteMany({ where: { orderNo: SENTINEL_NO } }); // crashed prior run
  const todayWin = resolveDashWindow({ range: "today" });
  const before = (await buildOwnerDashboard(todayWin, { showCosts: false }))
    .snapshot.delivered;
  try {
    await prisma.order.create({
      data: {
        orderNo: SENTINEL_NO,
        customerId: seedIds.customerId,
        salesExecutiveId: seedIds.userId,
        recipientName: "Verify 6a",
        recipientPhoneBd: "01700000000",
        deliveryAddress: "verify-only row",
        subtotal: 123.45,
        totalAmount: 123.45,
        dueAmount: 0,
        status: "DELIVERED",
        statusHistory: {
          create: {
            fromStatus: "IN_TRANSIT",
            toStatus: "DELIVERED",
            byUser: seedIds.userId,
            note: "verify-dashboard §6a temp row",
          },
        },
      },
    });
    const after = (await buildOwnerDashboard(todayWin, { showCosts: false }))
      .snapshot.delivered;
    check(
      "§6a stampless DELIVERED order counted via history fallback (+1)",
      after.count === before.count + 1,
      `before ${before.count} → after ${after.count}`
    );
    check(
      "§6a its amount joins the widget total (+123.45)",
      Math.abs(after.amount - before.amount - 123.45) < 0.01,
      `before ${before.amount} → after ${after.amount}`
    );
  } finally {
    await prisma.order.deleteMany({ where: { orderNo: SENTINEL_NO } });
  }
  const restored = (await buildOwnerDashboard(todayWin, { showCosts: false }))
    .snapshot.delivered;
  check(
    "§6a temp row removed — widget back to baseline",
    restored.count === before.count &&
      Math.abs(restored.amount - before.amount) < 0.01,
    `baseline ${before.count}/${before.amount} vs restored ${restored.count}/${restored.amount}`
  );

  // ── cost-blind lens (Manager without reports.pnl) ──
  console.log("\nOwner dashboard — showCosts=false (cost fields withheld)");
  const blind = await buildOwnerDashboard(month, { showCosts: false });
  check("stock value withheld", blind.inventory.stockValue === null);
  check("expense split withheld", blind.expenseSplit === null);
  check(
    "sales & collection still present",
    blind.money.sales >= 0 && blind.money.collection >= 0
  );

  // ── scoped funnel (role homes) ──
  console.log("\nScoped funnel (role-home reuse)");
  const anySE = await prisma.user.findFirst({
    where: { role: { name: "SalesExecutive" } },
    select: { id: true },
  });
  if (anySE) {
    const own = await buildFunnel({ salesExecutiveId: anySE.id });
    check(
      "SE-scoped funnel is monotonic",
      own.funnel.every((s, i) => i === 0 || s.count <= own.funnel[i - 1].count),
      own.funnel.map((s) => s.count).join(" ≥ ")
    );
  } else {
    check("SE-scoped funnel", true, "(no SE in demo data — skipped)");
  }

  // ── today window still resolves & builds ──
  console.log("\nOwner dashboard — today & custom windows build");
  const todayData = await buildOwnerDashboard(today, { showCosts: true });
  check("today window builds", todayData.window.fromYmd === dhakaYmd(new Date()));
  const customData = await buildOwnerDashboard(custom, { showCosts: true });
  check("custom (June) window builds", customData.window.range === "custom");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
