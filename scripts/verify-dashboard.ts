// Owner Dashboard verification (SPEC §13). Read-only: exercises the whole data
// aggregator against the live demo DB for every window type (today / week /
// month / custom) and both cost-visibility modes, asserting the widget
// invariants — funnel monotonicity, MTD-vs-last-month alignment, dues/COD
// snapshots, leaderboard ordering, country-share totals, and that the cost/
// profit fields are withheld when showCosts is false. No writes, no rollback
// needed. Run: npx tsx scripts/verify-dashboard.ts
import { PrismaClient } from "@prisma/client";
import {
  resolveDashWindow,
  buildOwnerDashboard,
  buildFunnel,
} from "../lib/dashboard";
import { dhakaYmd } from "../lib/pnl";

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
  const deliveredStage = d.funnel.find((x) => x.key === "delivered")?.count ?? -1;
  check(
    "§3 delivered count matches the funnel's delivered stage",
    s.delivered.count === deliveredStage,
    `${s.delivered.count} vs ${deliveredStage}`
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
