// Stock engine verification (SPEC §6.3). Runs the full flow —
// purchase → confirm (reserve) → pack (deduct + freeze cost) — inside ONE
// transaction that is rolled back at the end, so the seeded DB is untouched.
// Asserts the core invariant everywhere: available = SUM(all movements),
// stock_qty = SUM(physical), reserved_qty = −SUM(reserve rows).
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  applyPurchase,
  syncReservations,
  deductStockAtPack,
  weightedAvgCost,
} from "../lib/stock";

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

async function invariant(
  tx: Prisma.TransactionClient,
  productId: number,
  label: string
) {
  const p = await tx.product.findUniqueOrThrow({ where: { id: productId } });
  const rows = await tx.stockMovement.groupBy({
    by: ["type"],
    where: { productId },
    _sum: { qty: true },
  });
  let physical = 0;
  let reserveSum = 0;
  for (const r of rows) {
    const s = r._sum.qty ?? 0;
    if (r.type === "RESERVE" || r.type === "RELEASE_RESERVE") reserveSum += s;
    else physical += s;
  }
  const all = physical + reserveSum;
  check(
    `${label}: stock_qty (${p.stockQty}) = Σ physical (${physical})`,
    p.stockQty === physical
  );
  check(
    `${label}: reserved_qty (${p.reservedQty}) = −Σ reserve (${-reserveSum})`,
    p.reservedQty === -reserveSum
  );
  check(
    `${label}: available (${p.stockQty - p.reservedQty}) = Σ all movements (${all})`,
    p.stockQty - p.reservedQty === all
  );
}

async function main() {
  console.log("Stock engine verification — full flow in a rolled-back txn\n");

  // Pure weighted-average unit tests (SPEC §6.1)
  console.log("weighted-average cost:");
  check("10@100 + 10@120 → 110", weightedAvgCost(10, 100, 10, 120) === 110);
  check("0 on-hand + 5@50 → 50", weightedAvgCost(0, 999, 5, 50) === 50);
  check(
    "negative on-hand ignored (−3, avg 80) + 2@100 → 100",
    weightedAvgCost(-3, 80, 2, 100) === 100
  );
  console.log("");

  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { name: "Admin" } },
  });
  const teddy = await prisma.product.findUniqueOrThrow({ where: { sku: "GV-0001" } });
  const pkg = await prisma.package.findUniqueOrThrow({
    where: { code: "PKG-001" },
    include: { items: { include: { product: true } } },
  });
  const customer = await prisma.customer.findFirstOrThrow();

  console.log(
    `Baseline — ${teddy.name}: on-hand ${teddy.stockQty}, reserved ${teddy.reservedQty}, avg ৳${teddy.avgCost}`
  );
  console.log(
    `Package ${pkg.name} BOM: ${pkg.items.map((i) => `${i.qty}×${i.product.sku}`).join(", ")}\n`
  );

  try {
    await prisma.$transaction(
      async (tx) => {
        // ---- 1. PURCHASE: 20 × Teddy @ ৳500 (avg was 450) ----
        console.log("1. PURCHASE — 20 × Teddy Bear (M) @ ৳500");
        const beforeQty = teddy.stockQty;
        const beforeAvg = Number(teddy.avgCost);
        await applyPurchase(tx, {
          supplierName: "Verify Supplier Ltd",
          purchaseDate: new Date(),
          notes: "verification purchase",
          lines: [{ productId: teddy.id, qty: 20, unitCost: 500 }],
          userId: admin.id,
        });
        const afterPurchase = await tx.product.findUniqueOrThrow({
          where: { id: teddy.id },
        });
        const expectedAvg = weightedAvgCost(beforeQty, beforeAvg, 20, 500);
        check(
          `stock rose ${beforeQty} → ${afterPurchase.stockQty} (+20)`,
          afterPurchase.stockQty === beforeQty + 20
        );
        check(
          `weighted avg ৳${beforeAvg} → ৳${afterPurchase.avgCost} (expected ৳${expectedAvg})`,
          Number(afterPurchase.avgCost) === expectedAvg
        );
        const inMove = await tx.stockMovement.findFirst({
          where: { productId: teddy.id, type: "IN_PURCHASE", refTable: "purchases" },
          orderBy: { id: "desc" },
        });
        check("IN_PURCHASE movement written", inMove?.qty === 20);
        const expense = await tx.expense.findFirst({
          where: { refTable: "purchases", refId: inMove ? undefined : -1 },
          orderBy: { id: "desc" },
        });
        check(
          `auto-expense created (৳${expense?.amount})`,
          Number(expense?.amount) === 20 * 500
        );
        await invariant(tx, teddy.id, "after purchase");
        console.log("");

        // ---- 2. CONFIRM: order 1×PKG-001 + 2×Teddy, reserve stock ----
        console.log("2. CONFIRM — order of 1 × PKG-001 + 2 × Teddy → reserve");
        const reservedBefore: Record<number, number> = {};
        for (const it of pkg.items) {
          const p = await tx.product.findUniqueOrThrow({ where: { id: it.productId } });
          reservedBefore[it.productId] = p.reservedQty;
        }
        const teddyReservedBefore = (
          await tx.product.findUniqueOrThrow({ where: { id: teddy.id } })
        ).reservedQty;

        const order = await tx.order.create({
          data: {
            orderNo: "GV-VERIFY-0001",
            customerId: customer.id,
            recipientName: "Verify Recipient",
            recipientPhoneBd: "01700000000",
            deliveryAddress: "verify addr",
            district: "Dhaka",
            thana: "Dhanmondi",
            subtotal: 1,
            totalAmount: 1,
            dueAmount: 1,
            status: "CONFIRMED",
            salesExecutiveId: admin.id,
            items: {
              create: [
                { itemType: "PACKAGE", packageId: pkg.id, qty: 1, unitPrice: 1, lineTotal: 1 },
                { itemType: "PRODUCT", productId: teddy.id, qty: 2, unitPrice: 1, lineTotal: 1 },
              ],
            },
          },
        });
        await syncReservations(tx, order.id, admin.id);

        // Teddy is a package component (1×) AND a standalone line (2×) → +3 reserved
        const teddyAfterReserve = await tx.product.findUniqueOrThrow({
          where: { id: teddy.id },
        });
        check(
          `Teddy reserved ${teddyReservedBefore} → ${teddyAfterReserve.reservedQty} (+3: 2 line + 1 BOM)`,
          teddyAfterReserve.reservedQty === teddyReservedBefore + 3
        );
        // A non-Teddy tracked BOM component reserved by exactly its BOM qty
        const otherComp = pkg.items.find(
          (i) => i.productId !== teddy.id && i.product.isStockTracked
        )!;
        const otherAfter = await tx.product.findUniqueOrThrow({
          where: { id: otherComp.productId },
        });
        check(
          `${otherComp.product.sku} reserved +${otherComp.qty}`,
          otherAfter.reservedQty === reservedBefore[otherComp.productId] + otherComp.qty
        );
        check(
          "on-hand unchanged by reservation",
          teddyAfterReserve.stockQty === afterPurchase.stockQty
        );
        await invariant(tx, teddy.id, "after reserve");
        console.log("");

        // ---- 3. PACK: release reservation, deduct stock, freeze cost ----
        console.log("3. PACK — deduct stock + freeze unit_cost_snapshot");
        await deductStockAtPack(tx, order.id, admin.id);
        const teddyPacked = await tx.product.findUniqueOrThrow({
          where: { id: teddy.id },
        });
        check(
          `Teddy on-hand ${teddyAfterReserve.stockQty} → ${teddyPacked.stockQty} (−3)`,
          teddyPacked.stockQty === teddyAfterReserve.stockQty - 3
        );
        check(
          `Teddy reservation released (${teddyPacked.reservedQty} = baseline ${teddyReservedBefore})`,
          teddyPacked.reservedQty === teddyReservedBefore
        );
        const outMove = await tx.stockMovement.findFirst({
          where: { productId: teddy.id, type: "OUT_SALE", refTable: "orders", refId: order.id },
        });
        check("OUT_SALE movement written for the order", outMove?.qty === -3);

        const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
        const pkgLine = items.find((i) => i.itemType === "PACKAGE")!;
        const prodLine = items.find((i) => i.itemType === "PRODUCT")!;
        // Σ(component avg × BOM qty) with Teddy's post-purchase avg substituted.
        const expectedPkgCost =
          Math.round(
            pkg.items.reduce((s, i) => {
              const avg =
                i.productId === teddy.id
                  ? Number(teddyPacked.avgCost)
                  : Number(i.product.avgCost);
              return s + i.qty * avg;
            }, 0) * 100
          ) / 100;
        check(
          "PRODUCT line unit_cost_snapshot frozen to current avg cost",
          Number(prodLine.unitCostSnapshot) === Number(teddyPacked.avgCost)
        );
        check(
          `PACKAGE line unit_cost_snapshot = Σ component avg × BOM qty (৳${expectedPkgCost})`,
          Number(pkgLine.unitCostSnapshot) === expectedPkgCost
        );
        console.log(
          `     PACKAGE snapshot = ৳${pkgLine.unitCostSnapshot}, PRODUCT snapshot = ৳${prodLine.unitCostSnapshot}`
        );
        await invariant(tx, teddy.id, "after pack");
        console.log("");

        // ---- 4. CANCEL a fresh confirmed order restores reservation ----
        console.log("4. CANCEL — a confirmed (unpacked) order releases its reservation");
        const teddyPreCancel = (
          await tx.product.findUniqueOrThrow({ where: { id: teddy.id } })
        ).reservedQty;
        const order2 = await tx.order.create({
          data: {
            orderNo: "GV-VERIFY-0002",
            customerId: customer.id,
            recipientName: "Verify Recipient 2",
            recipientPhoneBd: "01700000001",
            deliveryAddress: "verify addr 2",
            district: "Dhaka",
            thana: "Dhanmondi",
            subtotal: 1, totalAmount: 1, dueAmount: 1,
            status: "CONFIRMED",
            salesExecutiveId: admin.id,
            items: {
              create: [{ itemType: "PRODUCT", productId: teddy.id, qty: 5, unitPrice: 1, lineTotal: 1 }],
            },
          },
        });
        await syncReservations(tx, order2.id, admin.id);
        const reservedMid = (
          await tx.product.findUniqueOrThrow({ where: { id: teddy.id } })
        ).reservedQty;
        check("reserve +5 on confirm", reservedMid === teddyPreCancel + 5);
        // simulate the status route's CANCELLED hook
        const { releaseOrderStock } = await import("../lib/stock");
        await releaseOrderStock(tx, order2.id, admin.id, {
          restoreDeducted: true,
          reason: "verify cancel",
        });
        const reservedAfterCancel = (
          await tx.product.findUniqueOrThrow({ where: { id: teddy.id } })
        ).reservedQty;
        check("reservation fully released on cancel", reservedAfterCancel === teddyPreCancel);
        await invariant(tx, teddy.id, "after cancel");

        throw new Error(ROLLBACK);
      },
      { timeout: 30000 }
    );
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
    console.log("\n(transaction rolled back — DB unchanged)\n");
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
