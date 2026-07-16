// Phase 2 end-to-end lifecycle verification (SPEC §16 items 8–12). Runs the full
// order journey — purchase → confirm (reserve) → pack (deduct + cost snapshot) →
// hand to courier → deliver → COD received → complete, then a separate return
// flow — inside ONE transaction that is rolled back at the end, so the seeded DB
// is untouched. Asserts the three money/stock invariants at every step:
//   • stock:    stock_qty = Σ physical movements, reserved_qty = −Σ reserve rows
//   • due:      order.due_amount = total − Σ(payments) tracked across the journey
//   • expenses: every auto-expense (purchase cost, COD fee, return charge) posts
//               exactly once, linked by ref, with the right amount.
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  applyPurchase,
  syncReservations,
  weightedAvgCost,
  orderStockRequirements,
} from "../lib/stock";
import { packageCost, productEffectiveCost } from "../lib/bom";
import { loadBomCatalog } from "../lib/bom-db";
import { applyStatusTransition, recomputeDue } from "../lib/orders";
import {
  applyHandover,
  applyShipmentStatus,
  applyCodReceived,
  applyReturnApproval,
} from "../lib/courier";
import type { OrderStatusValue } from "../lib/order-constants";

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

const round2 = (n: number) => Math.round(n * 100) / 100;

// stock ledger invariant for one product (same as verify-stock.ts)
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
  check(
    `${label}: stock_qty (${p.stockQty}) = Σ physical (${physical})`,
    p.stockQty === physical
  );
  check(
    `${label}: reserved_qty (${p.reservedQty}) = −Σ reserve (${-reserveSum})`,
    p.reservedQty === -reserveSum
  );
}

async function dueOf(tx: Prisma.TransactionClient, orderId: number) {
  const o = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { dueAmount: true, status: true },
  });
  return { due: Number(o.dueAmount), status: o.status };
}

// total of the auto-expenses linked to a ref (purchases/shipments row)
async function expenseFor(
  tx: Prisma.TransactionClient,
  refTable: string,
  refId: number
) {
  const rows = await tx.expense.findMany({
    where: { refTable, refId },
    select: { amount: true },
  });
  return {
    count: rows.length,
    total: round2(rows.reduce((s, e) => s + Number(e.amount), 0)),
  };
}

// stock snapshot for a whole requirements map (product → on-hand)
async function onHandMap(
  tx: Prisma.TransactionClient,
  productIds: number[]
): Promise<Map<number, number>> {
  const rows = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, stockQty: true },
  });
  return new Map(rows.map((r) => [r.id, r.stockQty]));
}

async function main() {
  console.log(
    "Phase 2 lifecycle verification — purchase → sale → courier → COD → return\n"
  );

  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { name: "Admin" } },
  });
  const teddy = await prisma.product.findUniqueOrThrow({
    where: { sku: "GV-0001" },
  });
  const pkg = await prisma.package.findUniqueOrThrow({
    where: { code: "PKG-001" },
    include: { items: { include: { product: true } } },
  });
  const customer = await prisma.customer.findFirstOrThrow();
  const courier = await prisma.courier.findFirstOrThrow({
    where: { isActive: true, name: "Steadfast" },
  });
  const wallet = await prisma.wallet.findFirstOrThrow({
    where: { isActive: true },
  });
  const feePercent = Number(courier.codFeePercent);

  console.log(
    `Baseline — ${teddy.name}: on-hand ${teddy.stockQty}, avg ৳${teddy.avgCost}`
  );
  console.log(
    `Courier ${courier.name} COD fee ${feePercent}%, wallet "${wallet.name}"\n`
  );

  try {
    await prisma.$transaction(
      async (tx) => {
        // =====================================================================
        // 1. PURCHASE — restock the SKUs this order will consume
        // =====================================================================
        console.log("1. PURCHASE — 20 × Teddy @ ৳500 (+ top up BOM components)");
        const beforeQty = teddy.stockQty;
        const beforeAvg = Number(teddy.avgCost);

        // top up every stock-tracked PKG-001 component so PACK never runs short
        const componentLines = pkg.items
          .filter((i) => i.product!.isStockTracked && i.productId !== teddy.id)
          .map((i) => ({ productId: i.productId!, qty: 50, unitCost: 100 }));

        const expensesBefore = (
          await tx.expense.aggregate({ _sum: { amount: true } })
        )._sum.amount;

        const purchase = await applyPurchase(tx, {
          supplierName: "Verify Supplier Ltd",
          purchaseDate: new Date(),
          notes: "lifecycle verification purchase",
          lines: [{ productId: teddy.id, qty: 20, unitCost: 500 }, ...componentLines],
          userId: admin.id,
        });

        const afterPurchase = await tx.product.findUniqueOrThrow({
          where: { id: teddy.id },
        });
        const expectedAvg = weightedAvgCost(beforeQty, beforeAvg, 20, 500);
        const expectedPurchaseTotal = round2(
          20 * 500 + componentLines.reduce((s, l) => s + l.qty * l.unitCost, 0)
        );
        check(
          `Teddy stock ${beforeQty} → ${afterPurchase.stockQty} (+20)`,
          afterPurchase.stockQty === beforeQty + 20
        );
        check(
          `Teddy weighted avg → ৳${afterPurchase.avgCost} (expected ৳${expectedAvg})`,
          Number(afterPurchase.avgCost) === expectedAvg
        );
        const purchaseExp = await expenseFor(tx, "purchases", purchase.id);
        check(
          `purchase auto-expense posted once (৳${purchaseExp.total}, expected ৳${expectedPurchaseTotal})`,
          purchaseExp.count === 1 && purchaseExp.total === expectedPurchaseTotal
        );
        const expensesAfterPurchase = (
          await tx.expense.aggregate({ _sum: { amount: true } })
        )._sum.amount;
        check(
          "total expenses rose by exactly the purchase cost",
          round2(Number(expensesAfterPurchase) - Number(expensesBefore ?? 0)) ===
            expectedPurchaseTotal
        );
        await invariant(tx, teddy.id, "after purchase");
        console.log("");

        // =====================================================================
        // 2. CREATE + CONFIRM — order with advance, reserve stock, due = total − advance
        // =====================================================================
        console.log("2. CONFIRM — 1×PKG-001 + 2×Teddy, advance ৳1200 → reserve");
        const TOTAL = 4920; // subtotal 5000 − discount 200 + courier 120
        const ADVANCE = 1200;
        const order = await tx.order.create({
          data: {
            orderNo: "GV-LIFECYCLE-0001",
            customerId: customer.id,
            recipientName: "Verify Recipient",
            recipientPhoneBd: "01700000000",
            deliveryAddress: "verify addr, Dhaka",
            district: "Dhaka",
            thana: "Dhanmondi",
            subtotal: 5000,
            discount: 200,
            courierChargeCustomer: 120,
            totalAmount: TOTAL,
            advanceAmount: ADVANCE,
            dueAmount: TOTAL, // recomputed once the payment exists
            codAmount: 0,
            status: "CONFIRMED",
            salesExecutiveId: admin.id,
            items: {
              create: [
                { itemType: "PACKAGE", packageId: pkg.id, qty: 1, unitPrice: 3400, lineTotal: 3400 },
                { itemType: "PRODUCT", productId: teddy.id, qty: 2, unitPrice: 800, lineTotal: 1600 },
              ],
            },
          },
        });
        // advance payment + due recompute (mirror the create route)
        await tx.payment.create({
          data: {
            orderId: order.id,
            type: "ADVANCE",
            method: "BKASH",
            amount: ADVANCE,
            walletId: wallet.id,
            transactionId: "VERIFY-TXN-0001",
            isVerified: true,
            verifiedBy: admin.id,
            createdBy: admin.id,
            updatedBy: admin.id,
          },
        });
        const dueAfterAdvance = await recomputeDue(tx, order.id);
        // COD defaults to the remaining due (mirror the create route's cod calc)
        await tx.order.update({
          where: { id: order.id },
          data: { codAmount: Math.max(dueAfterAdvance, 0) },
        });
        await syncReservations(tx, order.id, admin.id);

        check(
          `due = total − advance = ৳${TOTAL} − ৳${ADVANCE} = ৳${dueAfterAdvance}`,
          dueAfterAdvance === TOTAL - ADVANCE
        );

        // reservation covers every stock-tracked requirement (line + BOM expansion)
        const need = await orderStockRequirements(tx, order.id);
        const productIds = [...need.keys()];
        const onHandAtConfirm = await onHandMap(tx, productIds);
        let reserveOk = true;
        for (const [pid, qty] of need) {
          const p = await tx.product.findUniqueOrThrow({ where: { id: pid } });
          if (p.reservedQty < qty) reserveOk = false;
        }
        check("every required product reserved ≥ its need", reserveOk);
        const teddyReq = need.get(teddy.id) ?? 0;
        check(
          `Teddy reserved ${teddyReq} (2 line + ${teddyReq - 2} BOM)`,
          (await tx.product.findUniqueOrThrow({ where: { id: teddy.id } }))
            .reservedQty === teddyReq
        );
        check(
          "on-hand unchanged by reservation",
          (await tx.product.findUniqueOrThrow({ where: { id: teddy.id } }))
            .stockQty === afterPurchase.stockQty
        );
        await invariant(tx, teddy.id, "after confirm");
        console.log("");

        // =====================================================================
        // 3. PACK — deduct stock, release reservation, freeze cost snapshot
        // =====================================================================
        console.log("3. PACK — deduct on-hand + freeze unit_cost_snapshot");
        const orderRow = async () =>
          tx.order.findUniqueOrThrow({
            where: { id: order.id },
            select: { id: true, status: true, cancelReason: true },
          });
        await applyStatusTransition(
          tx,
          (await orderRow()) as { id: number; status: OrderStatusValue; cancelReason: string | null },
          "PACKED",
          admin.id,
          null
        );

        // every requirement deducted from on-hand; reservation back to 0 for this order
        let deductOk = true;
        for (const [pid, qty] of need) {
          const now = (await tx.product.findUniqueOrThrow({ where: { id: pid } }))
            .stockQty;
          if (now !== (onHandAtConfirm.get(pid) ?? 0) - qty) deductOk = false;
        }
        check("every required product deducted by its need", deductOk);

        const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
        const prodLine = items.find((i) => i.itemType === "PRODUCT")!;
        const pkgLine = items.find((i) => i.itemType === "PACKAGE")!;
        // Expected costs via the recursive BOM engine (CORRECTIONS Products
        // §2/§4/§5): the full explosion — nested lines, product packing
        // materials — priced at the CURRENT avg (step 1 topped up components,
        // so the weighted avgs moved; freezeCostSnapshots freezes the live
        // values at PACKED, SPEC §14 rule 4).
        const catalogAtPack = await loadBomCatalog(tx);
        const expectedPkgCost = packageCost(catalogAtPack, pkg.id);
        check(
          "PRODUCT line cost snapshot = current effective cost",
          Number(prodLine.unitCostSnapshot) ===
            productEffectiveCost(catalogAtPack, teddy.id)
        );
        check(
          `PACKAGE line cost snapshot = recursive BOM cost (৳${expectedPkgCost})`,
          Number(pkgLine.unitCostSnapshot) === expectedPkgCost
        );
        check(
          "packing did not change due",
          (await dueOf(tx, order.id)).due === TOTAL - ADVANCE
        );
        check("order now PACKED", (await dueOf(tx, order.id)).status === "PACKED");
        await invariant(tx, teddy.id, "after pack");
        console.log("");

        // =====================================================================
        // 4. HAND TO COURIER — create shipment, order → HANDED_TO_COURIER
        // =====================================================================
        console.log("4. HANDOVER — create shipment, COD = due");
        const codAmount = Math.max(dueAfterAdvance, 0);
        const onHandBeforeHandover = await onHandMap(tx, productIds);
        const shipment = await applyHandover(
          tx,
          {
            orderId: order.id,
            courierId: courier.id,
            trackingNo: "VERIFY-TRACK-0001",
            handoverDate: new Date(),
            codAmount,
            expectedDelivery: null,
            note: null,
          },
          admin.id
        );
        check(
          "shipment created HANDED_TO_COURIER",
          shipment.status === "HANDED_TO_COURIER"
        );
        check(
          "order now HANDED_TO_COURIER",
          (await dueOf(tx, order.id)).status === "HANDED_TO_COURIER"
        );
        let stockNeutralHandover = true;
        const afterHandover = await onHandMap(tx, productIds);
        for (const pid of productIds) {
          if (afterHandover.get(pid) !== onHandBeforeHandover.get(pid))
            stockNeutralHandover = false;
        }
        check("handover is stock-neutral", stockNeutralHandover);
        check(
          "handover did not change due",
          (await dueOf(tx, order.id)).due === TOTAL - ADVANCE
        );
        console.log("");

        // =====================================================================
        // 5. DELIVER — shipment DELIVERED, order → DELIVERED
        // =====================================================================
        console.log("5. DELIVER — shipment + order → DELIVERED");
        await applyShipmentStatus(
          tx,
          shipment.id,
          { to: "DELIVERED", note: null, courierCostActual: 80 },
          admin.id
        );
        const shipDelivered = await tx.shipment.findUniqueOrThrow({
          where: { id: shipment.id },
        });
        check("shipment DELIVERED", shipDelivered.status === "DELIVERED");
        check("deliveredAt stamped", shipDelivered.deliveredAt !== null);
        check(
          "order now DELIVERED",
          (await dueOf(tx, order.id)).status === "DELIVERED"
        );
        check(
          "delivery did not change due",
          (await dueOf(tx, order.id)).due === TOTAL - ADVANCE
        );
        console.log("");

        // =====================================================================
        // 6. COD RECEIVED — settle due, post courier COD fee expense
        // =====================================================================
        console.log("6. COD RECEIVED — reconcile: settle due + post COD fee");
        const expectedFee = round2((codAmount * feePercent) / 100);
        const result = await applyCodReceived(
          tx,
          [shipment.id],
          new Date(),
          admin.id,
          wallet.id
        );
        check("1 shipment reconciled", result.reconciled === 1);
        check(
          `COD collected ৳${result.totalCod} (expected ৳${codAmount})`,
          result.totalCod === codAmount
        );
        const dueAfterCod = await dueOf(tx, order.id);
        check(
          `due settled to ৳0 by COD payment (was ৳${TOTAL - ADVANCE})`,
          dueAfterCod.due === 0
        );
        const codPayment = await tx.payment.findFirst({
          where: { orderId: order.id, type: "COD_COURIER" },
        });
        check(
          `COD payment recorded (৳${codPayment ? Number(codPayment.amount) : 0}), verified`,
          Number(codPayment?.amount) === codAmount && codPayment?.isVerified === true
        );
        const feeExp = await expenseFor(tx, "shipments", shipment.id);
        check(
          `COD fee auto-expense posted once (৳${feeExp.total}, expected ৳${expectedFee})`,
          feeExp.count === 1 && feeExp.total === expectedFee
        );
        const shipReconciled = await tx.shipment.findUniqueOrThrow({
          where: { id: shipment.id },
        });
        check("shipment marked codReceived", shipReconciled.codReceived === true);

        // idempotency — re-running reconcile does nothing
        const rerun = await applyCodReceived(
          tx,
          [shipment.id],
          new Date(),
          admin.id,
          wallet.id
        );
        const feeExp2 = await expenseFor(tx, "shipments", shipment.id);
        check(
          "re-reconcile is idempotent (0 reconciled, no duplicate fee)",
          rerun.reconciled === 0 && feeExp2.count === 1
        );
        console.log("");

        // =====================================================================
        // 7. COMPLETE — allowed only because due = 0
        // =====================================================================
        console.log("7. COMPLETE — due is ৳0 so DELIVERED → COMPLETED is allowed");
        await applyStatusTransition(
          tx,
          (await orderRow()) as { id: number; status: OrderStatusValue; cancelReason: string | null },
          "COMPLETED",
          admin.id,
          null
        );
        check(
          "order COMPLETED",
          (await dueOf(tx, order.id)).status === "COMPLETED"
        );
        await invariant(tx, teddy.id, "after complete");
        console.log("");

        // =====================================================================
        // 8. RETURN FLOW — separate order, returned + approved restores stock
        // =====================================================================
        console.log("8. RETURN — pack → courier → RETURNED → approve restores stock");
        const onHandBeforeReturnOrder = await onHandMap(tx, [teddy.id]);
        const teddyBeforeReturn = onHandBeforeReturnOrder.get(teddy.id)!;

        const rOrder = await tx.order.create({
          data: {
            orderNo: "GV-LIFECYCLE-0002",
            customerId: customer.id,
            recipientName: "Return Recipient",
            recipientPhoneBd: "01700000002",
            deliveryAddress: "return addr, Dhaka",
            district: "Dhaka",
            thana: "Mirpur",
            subtotal: 2400,
            totalAmount: 2400,
            advanceAmount: 2400,
            dueAmount: 2400,
            codAmount: 0,
            status: "CONFIRMED",
            salesExecutiveId: admin.id,
            items: {
              create: [
                { itemType: "PRODUCT", productId: teddy.id, qty: 3, unitPrice: 800, lineTotal: 2400 },
              ],
            },
          },
        });
        // fully-paid advance so due = 0
        await tx.payment.create({
          data: {
            orderId: rOrder.id,
            type: "ADVANCE",
            method: "BKASH",
            amount: 2400,
            walletId: wallet.id,
            transactionId: "VERIFY-TXN-0002",
            isVerified: true,
            verifiedBy: admin.id,
            createdBy: admin.id,
            updatedBy: admin.id,
          },
        });
        await recomputeDue(tx, rOrder.id);
        await syncReservations(tx, rOrder.id, admin.id);

        const rOrderRow = async () =>
          tx.order.findUniqueOrThrow({
            where: { id: rOrder.id },
            select: { id: true, status: true, cancelReason: true },
          });
        await applyStatusTransition(
          tx,
          (await rOrderRow()) as { id: number; status: OrderStatusValue; cancelReason: string | null },
          "PACKED",
          admin.id,
          null
        );
        const teddyAfterRPack = (
          await tx.product.findUniqueOrThrow({ where: { id: teddy.id } })
        ).stockQty;
        check(
          `return order deducted 3 Teddy on pack (${teddyBeforeReturn} → ${teddyAfterRPack})`,
          teddyAfterRPack === teddyBeforeReturn - 3
        );

        const rShipment = await applyHandover(
          tx,
          {
            orderId: rOrder.id,
            courierId: courier.id,
            trackingNo: "VERIFY-TRACK-0002",
            handoverDate: new Date(),
            codAmount: 0,
            expectedDelivery: null,
            note: null,
          },
          admin.id
        );
        // courier reports RETURNED — stock restore waits for Admin approval (§1.3)
        await applyShipmentStatus(
          tx,
          rShipment.id,
          { to: "RETURNED", note: "customer refused", courierCostActual: null },
          admin.id
        );
        const teddyAfterReturnedStatus = (
          await tx.product.findUniqueOrThrow({ where: { id: teddy.id } })
        ).stockQty;
        check(
          "RETURNED status alone does NOT restore stock (waits for approval)",
          teddyAfterReturnedStatus === teddyAfterRPack
        );
        check(
          "order now RETURNED",
          (await dueOf(tx, rOrder.id)).status === "RETURNED"
        );

        // Admin approves the return with a ৳60 return courier charge
        const RETURN_CHARGE = 60;
        await applyReturnApproval(
          tx,
          rShipment.id,
          { returnCharge: RETURN_CHARGE, note: "approved" },
          admin.id
        );
        const teddyAfterApproval = (
          await tx.product.findUniqueOrThrow({ where: { id: teddy.id } })
        ).stockQty;
        check(
          `approval restored 3 Teddy (${teddyAfterReturnedStatus} → ${teddyAfterApproval})`,
          teddyAfterApproval === teddyBeforeReturn
        );
        const rShipApproved = await tx.shipment.findUniqueOrThrow({
          where: { id: rShipment.id },
        });
        check("return marked approved", rShipApproved.returnApproved === true);
        const returnExp = await expenseFor(tx, "shipments", rShipment.id);
        check(
          `return charge auto-expense posted once (৳${returnExp.total}, expected ৳${RETURN_CHARGE})`,
          returnExp.count === 1 && returnExp.total === RETURN_CHARGE
        );
        // idempotency — re-approval blocked
        let reApprovalBlocked = false;
        try {
          await applyReturnApproval(
            tx,
            rShipment.id,
            { returnCharge: RETURN_CHARGE, note: "again" },
            admin.id
          );
        } catch {
          reApprovalBlocked = true;
        }
        check("re-approval is blocked (no double stock/charge)", reApprovalBlocked);
        await invariant(tx, teddy.id, "after return approval");

        throw new Error(ROLLBACK);
      },
      { timeout: 60000 }
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
