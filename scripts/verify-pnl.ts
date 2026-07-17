// Accounting & Profit/Loss verification (SPEC §9.2 / §9.3, report R9). Asserts
// the exact per-order profit formula, the daily-average ad allocation, the
// monthly P&L identities (revenue − COGS − variable − fixed = net, with
// inventory purchases excluded), and the cost-blind RBAC (Sales/TL/Packing must
// never be able to reach the P&L). The manual-% allocation path is exercised
// inside a rolled-back transaction so the demo settings are left untouched.
import { PrismaClient } from "@prisma/client";
import {
  computeOrderProfit,
  buildPerOrderProfitReport,
  buildDailySummary,
  buildMonthlyPnl,
  getPnlSettings,
  savePnlSettings,
  dhakaYmd,
  dhakaYm,
} from "../lib/pnl";
import { round2 } from "../lib/pnl-constants";
import { dhakaDateBound } from "../lib/orders";
import { canSeeCosts } from "../lib/catalog";
import { getEffectivePermissions } from "../lib/rbac";
import {
  EXCLUDED_SALE_STATUSES,
  NON_SALE_STATUSES,
  type OrderStatusValue,
} from "../lib/order-constants";
import { PURCHASE_EXPENSE_CATEGORY } from "../lib/stock";
import { AD_COST_CATEGORY } from "../lib/expense-constants";

const prisma = new PrismaClient();
const ROLLBACK = "ROLLBACK_SENTINEL";
const DAY_MS = 24 * 60 * 60 * 1000;

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
const money = (a: number, b: number) => Math.abs(a - b) < 0.01;

async function main() {
  const from = new Date(Date.now() - 90 * DAY_MS);
  const to = new Date();

  // ---------- 1. Pure per-order formula (SPEC §9.2) ----------
  console.log("\n1. Per-order profit formula (computeOrderProfit)");
  {
    const parts = computeOrderProfit({
      sellValue: 1000,
      items: [
        { qty: 2, unitCostSnapshot: 100 },
        { qty: 1, unitCostSnapshot: 50 },
      ],
      courierCostActual: 120,
      hasShipment: true,
      packagingCost: 15,
      allocatedAd: 30,
    });
    check("product cost = Σ snapshot × qty (250)", money(parts.productCost, 250), `got ${parts.productCost}`);
    check(
      "profit = sell − product − courier − packaging − ad (585)",
      money(parts.profit, 585),
      `got ${parts.profit}`
    );
    check("margin % = profit ÷ sell (58.5)", money(parts.marginPct, 58.5), `got ${parts.marginPct}`);
    check("hasCostSnapshot true when all items frozen", parts.hasCostSnapshot === true);
    check("hasCourierActual true when shipment carries a cost", parts.hasCourierActual === true);
  }
  {
    const parts = computeOrderProfit({
      sellValue: 500,
      items: [{ qty: 1, unitCostSnapshot: null }],
      courierCostActual: null,
      hasShipment: false,
      packagingCost: 10,
      allocatedAd: 0,
    });
    check("missing snapshot → productCost 0 + flag false", parts.productCost === 0 && !parts.hasCostSnapshot);
    check("no shipment → courierCost 0 + flag false", parts.courierCost === 0 && !parts.hasCourierActual);
  }

  // ---------- 2. Per-order report vs raw data (daily-average allocation) ----------
  console.log("\n2. Per-order profit report — default (daily-average) allocation");
  const settings = await getPnlSettings();
  const report = await buildPerOrderProfitReport({ from, to });
  check("report returned some orders", report.rows.length > 0, `rows=${report.rows.length}`);

  // Recompute the per-day ad allocation exactly as the builder does.
  const [adRows, orderDays] = await Promise.all([
    prisma.expense.findMany({
      // expenseDate is @db.Date — same Dhaka-day bounds as buildAdAllocationByDay.
      where: {
        expenseDate: { gte: dhakaDateBound(from), lte: dhakaDateBound(to) },
        category: { name: AD_COST_CATEGORY },
      },
      select: { expenseDate: true, amount: true },
    }),
    prisma.order.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { createdAt: true },
    }),
  ]);
  const spendByDay = new Map<string, number>();
  for (const e of adRows) {
    const k = dhakaYmd(e.expenseDate);
    spendByDay.set(k, round2((spendByDay.get(k) ?? 0) + Number(e.amount)));
  }
  const countByDay = new Map<string, number>();
  for (const o of orderDays) {
    const k = dhakaYmd(o.createdAt);
    countByDay.set(k, (countByDay.get(k) ?? 0) + 1);
  }
  const expectedAdForDay = (ymd: string) =>
    spendByDay.has(ymd)
      ? round2(spendByDay.get(ymd)! / Math.max(countByDay.get(ymd) ?? 0, 1))
      : 0;

  let allocMatches = true;
  let profitMatches = true;
  let productMatches = true;
  for (const r of report.rows) {
    if (settings.adAllocationMethod === "daily_average") {
      const exp = expectedAdForDay(dhakaYmd(new Date(r.createdAt)));
      if (!money(r.adCost, exp)) {
        allocMatches = false;
        console.log(`    ${r.orderNo}: adCost ${r.adCost} ≠ expected ${exp}`);
      }
    }
    // Re-derive product cost straight from the order's items.
    const items = await prisma.orderItem.findMany({
      where: { orderId: r.orderId },
      select: { qty: true, unitCostSnapshot: true },
    });
    const expProduct = round2(
      items.reduce((s, it) => s + Number(it.unitCostSnapshot ?? 0) * it.qty, 0)
    );
    if (!money(r.productCost, expProduct)) productMatches = false;
    const expProfit = round2(
      r.sellValue - r.productCost - r.courierCost - r.packagingCost - r.adCost
    );
    if (!money(r.profit, expProfit)) profitMatches = false;
  }
  check("ad cost per order = day spend ÷ day orders", allocMatches);
  check("product cost = Σ order-item snapshots", productMatches);
  check("profit = sell − all four cost components (every row)", profitMatches);

  const saleRows = report.rows.filter((r) => r.isSale);
  const totalProfit = round2(saleRows.reduce((s, r) => s + r.profit, 0));
  check("totals.profit = Σ sale-row profit", money(report.totals.profit, totalProfit), `${report.totals.profit} vs ${totalProfit}`);
  check(
    "totals exclude non-sale statuses",
    report.totals.orderCount === saleRows.length &&
      saleRows.every((r) => !NON_SALE_STATUSES.includes(r.status as OrderStatusValue))
  );

  // ---------- 3. Manual-% allocation (rolled-back tx) ----------
  console.log("\n3. Per-order profit — manual-% allocation (rolled back)");
  try {
    await prisma.$transaction(async (tx) => {
      await savePnlSettings(
        { packagingCostPerOrder: 5, adAllocationMethod: "manual_percent", adManualPercent: 10 },
        tx
      );
      const r2 = await buildPerOrderProfitReport({ from, to }, tx);
      let ok = r2.rows.length > 0;
      for (const r of r2.rows) {
        const expAd = round2((r.sellValue * 10) / 100);
        if (!money(r.adCost, expAd) || !money(r.packagingCost, 5)) ok = false;
      }
      check("manual %: adCost = 10% of sell, packaging = ৳5 (every row)", ok);
      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
  }
  const after = await getPnlSettings();
  check(
    "settings restored after rollback",
    after.adAllocationMethod === settings.adAllocationMethod &&
      money(after.packagingCostPerOrder, settings.packagingCostPerOrder)
  );

  // ---------- 4. Daily summary identities (SPEC §9.3) ----------
  console.log("\n4. Daily summary");
  const daily = await buildDailySummary({ from, to });
  const sumSales = round2(daily.rows.reduce((s, r) => s + r.salesValue, 0));
  const sumCosts = round2(daily.rows.reduce((s, r) => s + r.costs, 0));
  const sumColl = round2(daily.rows.reduce((s, r) => s + r.collection, 0));
  check("totals.salesValue = Σ daily sales", money(daily.totals.salesValue, sumSales));
  check("totals.costs = Σ daily costs", money(daily.totals.costs, sumCosts));
  check("totals.collection = Σ daily collection", money(daily.totals.collection, sumColl));
  check("net = sales − costs on every day", daily.rows.every((r) => money(r.net, round2(r.salesValue - r.costs))));

  // Costs total reconciles with the raw expense ledger for the window.
  const expenseAgg = await prisma.expense.aggregate({
    // expenseDate is @db.Date — same Dhaka-day bounds as buildDailySummary.
    where: { expenseDate: { gte: dhakaDateBound(from), lte: dhakaDateBound(to) } },
    _sum: { amount: true },
  });
  check(
    "daily costs total = Σ all expenses in window",
    money(daily.totals.costs, round2(Number(expenseAgg._sum.amount ?? 0)))
  );

  // ---------- 5. Monthly P&L identities (SPEC §9.2) ----------
  console.log("\n5. Monthly P&L");
  const ym = dhakaYm();
  const pnl = await buildMonthlyPnl({ ym, basis: "confirmed" });
  const cur = pnl.current;
  check("gross profit = revenue − COGS", money(cur.grossProfit, round2(cur.revenue - cur.cogs)));
  check(
    "net profit = gross − variable − fixed",
    money(cur.netProfit, round2(cur.grossProfit - cur.variableCost - cur.fixedCost))
  );
  check(
    "gross margin % = gross ÷ revenue",
    cur.revenue > 0 ? money(cur.grossMarginPct, round2((cur.grossProfit / cur.revenue) * 100)) : true
  );
  check(
    "net margin % = net ÷ revenue",
    cur.revenue > 0 ? money(cur.netMarginPct, round2((cur.netProfit / cur.revenue) * 100)) : true
  );
  check(
    "per-order avg profit = net ÷ order count",
    cur.orderCount > 0 ? money(cur.perOrderAvgProfit, round2(cur.netProfit / cur.orderCount)) : true
  );
  check("previous month is the month before", pnl.previous.ym < ym);
  check("net delta = current − previous net", money(pnl.deltas.netProfit, round2(cur.netProfit - pnl.previous.netProfit)));

  // Operating costs exclude the "Product Purchase" category (COGS covers goods).
  const [start, next] = [
    new Date(`${ym}-01T00:00:00+06:00`),
    (() => {
      const [y, m] = ym.split("-").map(Number);
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      return new Date(`${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+06:00`);
    })(),
  ];
  const monthExpenses = await prisma.expense.findMany({
    // expenseDate is @db.Date — same Dhaka-day bounds as buildMonthlyPnl.
    where: { expenseDate: { gte: dhakaDateBound(start), lt: dhakaDateBound(next) } },
    select: { amount: true, category: { select: { name: true, costType: true } } },
  });
  let expVar = 0;
  let expFix = 0;
  let expInv = 0;
  for (const e of monthExpenses) {
    const amt = Number(e.amount);
    if (e.category.name === PURCHASE_EXPENSE_CATEGORY) expInv = round2(expInv + amt);
    else if (e.category.costType === "FIXED") expFix = round2(expFix + amt);
    else expVar = round2(expVar + amt);
  }
  check("variable cost = Σ variable expenses (excl. Product Purchase)", money(cur.variableCost, expVar), `${cur.variableCost} vs ${expVar}`);
  check("fixed cost = Σ fixed expenses", money(cur.fixedCost, expFix), `${cur.fixedCost} vs ${expFix}`);
  check("inventory purchased tracked separately (excluded)", money(cur.inventoryPurchased, expInv), `${cur.inventoryPurchased} vs ${expInv}`);

  // Revenue + COGS reconcile with the confirmed-basis orders directly.
  // EXCLUDED_SALE_STATUSES: lib/pnl.ts drops DRAFT (committed-but-unpaid,
  // CORRECTIONS Leads §10) as well as the lost trio.
  const monthOrders = await prisma.order.findMany({
    where: { createdAt: { gte: start, lt: next }, status: { notIn: EXCLUDED_SALE_STATUSES } },
    select: { totalAmount: true, items: { select: { qty: true, unitCostSnapshot: true } } },
  });
  const expRevenue = round2(monthOrders.reduce((s, o) => s + Number(o.totalAmount), 0));
  const expCogs = round2(
    monthOrders.reduce(
      (s, o) => s + o.items.reduce((t, it) => t + Number(it.unitCostSnapshot ?? 0) * it.qty, 0),
      0
    )
  );
  check("revenue = Σ confirmed-order totals in month", money(cur.revenue, expRevenue), `${cur.revenue} vs ${expRevenue}`);
  check("COGS = Σ snapshot costs of month orders", money(cur.cogs, expCogs), `${cur.cogs} vs ${expCogs}`);

  // ---------- 6. Cost-blind RBAC (CLAUDE.md rule 1) ----------
  console.log("\n6. RBAC — P&L is cost-visible-only");
  // Active humans only — the inactive "Steadfast (system)" machine account
  // carries a role purely as an FK filler and can never log in, so the
  // role→cost-visibility promise doesn't apply to it.
  const roleUsers = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { name: { in: ["SalesExecutive", "TeamLeader", "Packing", "Accounts", "Admin"] } },
    },
    select: { id: true, role: { select: { name: true } } },
  });
  for (const u of roleUsers) {
    const perms = await getEffectivePermissions(u.id);
    const sees = canSeeCosts(perms) && perms.includes("reports.pnl");
    const shouldSee = u.role.name === "Admin" || u.role.name === "Accounts";
    check(
      `${u.role.name} ${shouldSee ? "can" : "cannot"} reach P&L (reports.pnl)`,
      sees === shouldSee
    );
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
