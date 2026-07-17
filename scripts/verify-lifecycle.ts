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
  orderStockNets,
  releaseOrderStock,
} from "../lib/stock";
import { packageCost, productEffectiveCost } from "../lib/bom";
import { loadBomCatalog } from "../lib/bom-db";
import {
  applyStatusTransition,
  confirmDraftTx,
  nextDraftNo,
  recomputeDue,
} from "../lib/orders";
import {
  applyHandover,
  applyShipmentStatus,
  applyCodReceived,
  applyReturnReceive,
  buildReturnInspection,
  autoPackForHandover,
} from "../lib/courier";
import { explodePackage, packageAvailability } from "../lib/bom";
import {
  ingestDeliveryStatus,
  shipmentForSyncInclude,
  type ShipmentForSync,
} from "../lib/steadfast-sync";
import { DAMAGED_STOCK_EXPENSE_CATEGORY } from "../lib/courier-constants";
import {
  TRASH_RETENTION_DAYS,
  type OrderStatusValue,
} from "../lib/order-constants";

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
        // 8. RETURN FLOW (CORRECTIONS §6m/§6n) — courier sub-states while In
        //    Transit, auto-move to Returned on final approval, then the
        //    Packaging team's receive-time damage inspection (2 OK + 1 damaged)
        // =====================================================================
        console.log("8. RETURN — §6m courier statuses → §6n receive + inspection");
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

        // §6m — the courier-side journey via the SAME ingest path the webhook
        // and poller use. Warehouse receive ("pending") auto-enters In Transit.
        const loadSync = async () =>
          (await tx.shipment.findUniqueOrThrow({
            where: { id: rShipment.id },
            include: shipmentForSyncInclude,
          })) as unknown as ShipmentForSync;
        const rShip = async () =>
          tx.shipment.findUniqueOrThrow({ where: { id: rShipment.id } });

        await ingestDeliveryStatus(tx, {
          shipment: await loadSync(),
          rawStatus: "pending",
          source: "WEBHOOK",
          rawPayload: { status: "pending" },
        });
        check(
          "warehouse receive ('pending') auto-enters IN_TRANSIT (§6m)",
          (await dueOf(tx, rOrder.id)).status === "IN_TRANSIT"
        );
        check(
          "courier status = PENDING, rider unassigned",
          (await rShip()).courierStatus === "PENDING" &&
            (await rShip()).riderName === null
        );

        // Rider info in a payload → PENDING flips to ASSIGNED (§6m).
        await ingestDeliveryStatus(tx, {
          shipment: await loadSync(),
          rawStatus: "pending",
          source: "POLL",
          rawPayload: {
            status: "pending",
            rider: { name: "Verify Rider", phone: "01911111111" },
          },
        });
        const assigned = await rShip();
        check(
          "rider payload → courier status ASSIGNED + rider stored",
          assigned.courierStatus === "ASSIGNED" &&
            assigned.riderName === "Verify Rider" &&
            assigned.riderPhone === "01911111111"
        );

        // Return approval-wait: order STAYS In Transit under the sub-tab (§6m).
        await ingestDeliveryStatus(tx, {
          shipment: await loadSync(),
          rawStatus: "cancelled_approval_pending",
          source: "WEBHOOK",
          rawPayload: { status: "cancelled_approval_pending" },
        });
        check(
          "'cancelled_approval_pending' keeps the order IN_TRANSIT (§6m)",
          (await dueOf(tx, rOrder.id)).status === "IN_TRANSIT"
        );
        check(
          "courier status = RETURN_APPROVAL_PENDING",
          (await rShip()).courierStatus === "RETURN_APPROVAL_PENDING"
        );

        // Final approval → auto-move to the Returned tab, Pending sub-tab (§6n).
        await ingestDeliveryStatus(tx, {
          shipment: await loadSync(),
          rawStatus: "cancelled",
          source: "WEBHOOK",
          rawPayload: { status: "cancelled" },
        });
        const teddyAfterReturnedStatus = (
          await tx.product.findUniqueOrThrow({ where: { id: teddy.id } })
        ).stockQty;
        check(
          "final 'cancelled' → order RETURNED (Pending sub-tab)",
          (await dueOf(tx, rOrder.id)).status === "RETURNED" &&
            (await rShip()).returnReceivedAt === null
        );
        check(
          "RETURNED alone does NOT restore stock (§6n: waits for receive)",
          teddyAfterReturnedStatus === teddyAfterRPack
        );

        // §6n — the Packaging team receives the parcel: BOM-exploded inspection
        // sheet, then 2 Teddy OK + 1 damaged.
        const inspection = await buildReturnInspection(tx, rOrder.id);
        const teddyLine = inspection.find((i) => i.productId === teddy.id);
        check(
          `inspection sheet lists 3 Teddy to come back (got ${teddyLine?.qty ?? 0})`,
          teddyLine?.qty === 3
        );

        const RETURN_CHARGE = 60;
        const teddyAvgAtReceive = Number(
          (
            await tx.product.findUniqueOrThrow({
              where: { id: teddy.id },
              select: { avgCost: true },
            })
          ).avgCost
        );
        const receive = await applyReturnReceive(
          tx,
          rShipment.id,
          {
            items: [{ productId: teddy.id, damagedQty: 1 }],
            note: "box crushed",
            returnCharge: RETURN_CHARGE,
          },
          admin.id
        );
        check(
          `receive restored 2 and logged 1 damaged (got ${receive.restoredQty}/${receive.damagedQty})`,
          receive.restoredQty === 2 && receive.damagedQty === 1
        );
        const teddyAfterReceive = (
          await tx.product.findUniqueOrThrow({ where: { id: teddy.id } })
        ).stockQty;
        check(
          `OK units back in stock, damaged unit NOT (${teddyAfterReturnedStatus} → ${teddyAfterReceive})`,
          teddyAfterReceive === teddyBeforeReturn - 1
        );

        const damageRows = await tx.damageLog.findMany({
          where: { shipmentId: rShipment.id },
        });
        check(
          `damage log: 1 row, qty 1, cost frozen at avg (৳${teddyAvgAtReceive})`,
          damageRows.length === 1 &&
            damageRows[0].qty === 1 &&
            damageRows[0].productId === teddy.id &&
            Number(damageRows[0].unitCost) === teddyAvgAtReceive &&
            damageRows[0].inspectedBy === admin.id
        );

        // Money: the at-cost loss ("Damaged Stock") + the return courier charge
        // both post once, linked to the shipment.
        const expectedLoss = round2(1 * teddyAvgAtReceive);
        const returnExp = await expenseFor(tx, "shipments", rShipment.id);
        check(
          `loss + return charge posted once each (৳${returnExp.total}, expected ৳${round2(expectedLoss + RETURN_CHARGE)})`,
          returnExp.count === 2 &&
            returnExp.total === round2(expectedLoss + RETURN_CHARGE)
        );
        const lossExpense = await tx.expense.findFirst({
          where: {
            refTable: "shipments",
            refId: rShipment.id,
            category: { name: DAMAGED_STOCK_EXPENSE_CATEGORY },
          },
          include: { category: true },
        });
        check(
          `damaged loss in "${DAMAGED_STOCK_EXPENSE_CATEGORY}" category (৳${Number(lossExpense?.amount ?? 0)})`,
          lossExpense != null && Number(lossExpense.amount) === expectedLoss
        );

        const rShipReceived = await rShip();
        check(
          "shipment stamped received + approved (legacy compat), by Admin",
          rShipReceived.returnReceivedAt !== null &&
            rShipReceived.returnReceivedBy === admin.id &&
            rShipReceived.returnApproved === true
        );

        // idempotency — a second receive is blocked (no double stock/loss)
        let reReceiveBlocked = false;
        try {
          await applyReturnReceive(
            tx,
            rShipment.id,
            { items: [], note: "again" },
            admin.id
          );
        } catch {
          reReceiveBlocked = true;
        }
        check("re-receive is blocked (no double stock/loss)", reReceiveBlocked);
        await invariant(tx, teddy.id, "after return receive");
        console.log("");

        // =====================================================================
        // 9. DRAFT → CONFIRM (CORRECTIONS Leads §9/§10) — committed lead, draft
        //    order (no reserve/no sale), advance lands → real number + reserve
        //    + lead converted
        // =====================================================================
        console.log("9. DRAFT — committed lead, unpaid draft, confirm on payment");
        const dLead = await tx.lead.create({
          data: {
            leadDate: new Date(),
            source: "WHATSAPP",
            customerName: "Draft Verify Customer",
            whatsappNumber: "+966500000099",
            status: "COMMITTED",
            committedAt: new Date(),
            assignedTo: admin.id,
          },
        });
        const draftNo = await nextDraftNo(tx);
        check(`draft number uses DRAFT- prefix (${draftNo})`, draftNo.startsWith("DRAFT-"));
        const teddyBeforeDraft = await tx.product.findUniqueOrThrow({
          where: { id: teddy.id },
          select: { reservedQty: true },
        });
        const dTOTAL = 1600;
        const dOrder = await tx.order.create({
          data: {
            orderNo: draftNo,
            leadId: dLead.id,
            customerId: customer.id,
            recipientName: "Draft Recipient",
            recipientPhoneBd: "01700000003",
            deliveryAddress: "draft addr, Dhaka",
            deliveryDateMode: "ASAP",
            subtotal: dTOTAL,
            totalAmount: dTOTAL,
            dueAmount: dTOTAL,
            codAmount: dTOTAL,
            status: "DRAFT",
            salesExecutiveId: admin.id,
            items: {
              create: [
                { itemType: "PRODUCT", productId: teddy.id, qty: 2, unitPrice: 800, lineTotal: 1600 },
              ],
            },
          },
        });
        await tx.orderStatusHistory.create({
          data: { orderId: dOrder.id, fromStatus: null, toStatus: "DRAFT", byUser: admin.id },
        });
        const teddyAfterDraft = await tx.product.findUniqueOrThrow({
          where: { id: teddy.id },
          select: { reservedQty: true },
        });
        check(
          "saving a draft reserves NOTHING",
          teddyAfterDraft.reservedQty === teddyBeforeDraft.reservedQty
        );

        // Advance lands → the payments route records the payment, recomputes
        // due, then confirms the draft (mirrored here).
        const D_ADVANCE = 600;
        await tx.payment.create({
          data: {
            orderId: dOrder.id,
            type: "ADVANCE",
            method: "BKASH",
            amount: D_ADVANCE,
            walletId: wallet.id,
            transactionId: "VERIFY-TXN-0003",
            createdBy: admin.id,
            updatedBy: admin.id,
          },
        });
        await recomputeDue(tx, dOrder.id);
        const { orderNo: realNo } = await confirmDraftTx(
          tx,
          dOrder.id,
          admin.id,
          "advance received"
        );
        const dConfirmed = await tx.order.findUniqueOrThrow({
          where: { id: dOrder.id },
        });
        check(
          `confirm assigned the real GV number (${draftNo} → ${realNo})`,
          /^GV-\d{4}-\d{4}$/.test(realNo) && dConfirmed.orderNo === realNo
        );
        check("draft is now CONFIRMED", dConfirmed.status === "CONFIRMED");
        check(
          `advance snapshot = paid amount (৳${Number(dConfirmed.advanceAmount)})`,
          Number(dConfirmed.advanceAmount) === D_ADVANCE
        );
        check(
          `due = total − advance (৳${Number(dConfirmed.dueAmount)})`,
          Number(dConfirmed.dueAmount) === dTOTAL - D_ADVANCE
        );
        const teddyAfterConfirm = await tx.product.findUniqueOrThrow({
          where: { id: teddy.id },
          select: { reservedQty: true },
        });
        check(
          "confirmation reserved the draft's stock (+2 Teddy)",
          teddyAfterConfirm.reservedQty === teddyBeforeDraft.reservedQty + 2
        );
        const dLeadAfter = await tx.lead.findUniqueOrThrow({
          where: { id: dLead.id },
          select: { status: true },
        });
        check("linked lead flipped COMMITTED → CONVERTED", dLeadAfter.status === "CONVERTED");
        const dHistory = await tx.orderStatusHistory.findMany({
          where: { orderId: dOrder.id },
          orderBy: { at: "asc" },
        });
        check(
          "history shows DRAFT creation + DRAFT → CONFIRMED",
          dHistory.length === 2 &&
            dHistory[0].toStatus === "DRAFT" &&
            dHistory[1].fromStatus === "DRAFT" &&
            dHistory[1].toStatus === "CONFIRMED"
        );
        await invariant(tx, teddy.id, "after draft confirm");
        console.log("");

        // =====================================================================
        // 10. NESTED COMBO + CHOICE (Products §5) + §6j send-from-CONFIRMED —
        //     C10 items 1+3: a combo containing a sub-package and a choice
        //     group, ordered with the NON-default variant, auto-packed straight
        //     from CONFIRMED (the Steadfast-send pre-pack), then the §6m ladder
        //     pending → rider → Delivery Approval Pending → Delivered + COD.
        // =====================================================================
        console.log(
          "10. NESTED COMBO — choice variant, §6j CONFIRMED send, approval ladder, COD"
        );
        const combo = await tx.package.findUniqueOrThrow({
          where: { code: "PKG-004" },
          include: {
            items: { include: { options: { include: { product: true } } } },
          },
        });
        const choiceLine = combo.items.find((i) => i.kind === "CHOICE");
        check(
          "PKG-004 nests a sub-package AND carries a choice group",
          combo.items.some((i) => i.kind === "PACKAGE") && choiceLine != null
        );
        if (!choiceLine) throw new Error("PKG-004 lost its choice group — reseed");
        const defaultOpt =
          choiceLine.options.find((o) => o.isDefault) ?? choiceLine.options[0];
        const variantOpt = choiceLine.options.find((o) => o.id !== defaultOpt.id)!;
        const picks = new Map([[choiceLine.id, variantOpt.productId]]);

        // Top up every stock-tracked leaf of the CHOSEN explosion (sub-package
        // contents + component-only materials included) and buy the variant at
        // a deliberately different cost so variant-vs-default costs can't tie.
        const catalogPre = await loadBomCatalog(tx);
        const chosenExplosion = explodePackage(catalogPre, combo.id, 1, picks);
        check(
          "chosen explosion contains the variant, NOT the default option",
          (chosenExplosion.get(variantOpt.productId) ?? 0) >= 1 &&
            !chosenExplosion.has(defaultOpt.productId)
        );
        const comboDirectIds = new Set(
          combo.items.map((i) => i.productId).filter((x): x is number => x != null)
        );
        const nestedLeafId = [...chosenExplosion.keys()].find(
          (pid) =>
            !comboDirectIds.has(pid) &&
            pid !== variantOpt.productId &&
            catalogPre.products.get(pid)?.isStockTracked
        );
        check(
          "explosion reaches leaves that only exist inside the sub-package",
          nestedLeafId !== undefined
        );
        await applyPurchase(tx, {
          supplierName: "Verify Supplier Ltd",
          purchaseDate: new Date(),
          notes: "nested-combo verification top-up",
          lines: [...chosenExplosion.keys()]
            .filter((pid) => catalogPre.products.get(pid)?.isStockTracked)
            .map((pid) => ({
              productId: pid,
              qty: 30,
              unitCost: pid === variantOpt.productId ? 999 : 120,
            })),
          userId: admin.id,
        });
        const catalogStocked = await loadBomCatalog(tx);
        const availBefore = packageAvailability(catalogStocked, combo.id, picks);
        check(
          `combo availability computes with the chosen variant (${availBefore})`,
          availBefore !== null && availBefore >= 1
        );

        // Order the combo CONFIRMED with the stored choice pick (the §5 shape:
        // groupId = the CHOICE line's package_items.id).
        const N_TOTAL = 5500;
        const N_ADVANCE = 1500;
        const nOrder = await tx.order.create({
          data: {
            orderNo: "GV-LIFECYCLE-0003",
            customerId: customer.id,
            recipientName: "Combo Recipient",
            recipientPhoneBd: "01700000004",
            deliveryAddress: "combo addr, Dhaka",
            subtotal: N_TOTAL,
            totalAmount: N_TOTAL,
            advanceAmount: N_ADVANCE,
            dueAmount: N_TOTAL,
            codAmount: 0,
            status: "CONFIRMED",
            salesExecutiveId: admin.id,
            items: {
              create: [
                {
                  itemType: "PACKAGE",
                  packageId: combo.id,
                  qty: 1,
                  unitPrice: N_TOTAL,
                  lineTotal: N_TOTAL,
                  choiceSelections: [
                    {
                      groupId: choiceLine.id,
                      label: choiceLine.choiceLabel ?? "Choice",
                      productId: variantOpt.productId,
                      name: variantOpt.product.name,
                    },
                  ],
                },
              ],
            },
          },
        });
        await tx.payment.create({
          data: {
            orderId: nOrder.id,
            type: "ADVANCE",
            method: "BKASH",
            amount: N_ADVANCE,
            walletId: wallet.id,
            transactionId: "VERIFY-TXN-0004",
            isVerified: true,
            verifiedBy: admin.id,
            createdBy: admin.id,
            updatedBy: admin.id,
          },
        });
        const nDue = await recomputeDue(tx, nOrder.id);
        await tx.order.update({
          where: { id: nOrder.id },
          data: { codAmount: Math.max(nDue, 0) },
        });
        await syncReservations(tx, nOrder.id, admin.id);

        // Reserve must equal the CHOSEN explosion exactly — every leaf, and
        // nothing for the default option (choice isolation).
        const nNeed = await orderStockRequirements(tx, nOrder.id);
        const trackedChosen = new Map(
          [...chosenExplosion].filter(
            ([pid]) => catalogPre.products.get(pid)?.isStockTracked
          )
        );
        const needMatches =
          nNeed.size === trackedChosen.size &&
          [...trackedChosen].every(([pid, qty]) => nNeed.get(pid) === qty);
        check(
          `stored choice pick drives the requirement map (${nNeed.size} leaves match)`,
          needMatches,
          `need ${JSON.stringify([...nNeed])} vs explosion ${JSON.stringify([...trackedChosen])}`
        );
        check(
          "variant reserved, default option NOT reserved",
          !nNeed.has(defaultOpt.productId) &&
            (nNeed.get(variantOpt.productId) ?? 0) >= 1
        );
        const nets = await orderStockNets(tx, nOrder.id);
        const reservedMatches = [...nNeed].every(
          ([pid, qty]) => (nets.reserved.get(pid) ?? 0) === qty
        );
        check("ledger reserve rows match the exploded need", reservedMatches);
        check(
          "sub-package-only leaf reserved too (nested explosion)",
          nestedLeafId !== undefined &&
            (nets.reserved.get(nestedLeafId) ?? 0) ===
              (nNeed.get(nestedLeafId) ?? -1)
        );
        await invariant(tx, variantOpt.productId, "after combo confirm");

        // §6j — the Steadfast send from the CONFIRMED tab pre-packs via the
        // same autoPackForHandover the send route calls BEFORE the network hop.
        const onHandBeforePack = await onHandMap(tx, [...nNeed.keys()]);
        await autoPackForHandover(
          tx,
          {
            id: nOrder.id,
            status: "CONFIRMED",
            cancelReason: null,
          },
          admin.id
        );
        check(
          "§6j auto-pack flips CONFIRMED → PACKED",
          (await dueOf(tx, nOrder.id)).status === "PACKED"
        );
        const autoPackHist = await tx.orderStatusHistory.findFirst({
          where: { orderId: nOrder.id, toStatus: "PACKED" },
        });
        check(
          "§6j pack history notes the auto-pack",
          (autoPackHist?.note ?? "").includes("Auto-packed")
        );
        let comboDeductOk = true;
        for (const [pid, qty] of nNeed) {
          const nowQty = (
            await tx.product.findUniqueOrThrow({ where: { id: pid } })
          ).stockQty;
          if (nowQty !== (onHandBeforePack.get(pid) ?? 0) - qty)
            comboDeductOk = false;
        }
        check("auto-pack deducted EVERY exploded leaf by its qty", comboDeductOk);
        const netsPacked = await orderStockNets(tx, nOrder.id);
        check(
          "reservations fully released on pack",
          [...nNeed.keys()].every((pid) => (netsPacked.reserved.get(pid) ?? 0) === 0)
        );

        // Cost snapshot = recursive BOM cost of the CHOSEN variant — and the
        // ৳999 variant purchase guarantees it differs from the default cost.
        const catalogAtComboPack = await loadBomCatalog(tx);
        const nItem = await tx.orderItem.findFirstOrThrow({
          where: { orderId: nOrder.id },
        });
        const chosenCost = packageCost(catalogAtComboPack, combo.id, picks);
        const defaultCost = packageCost(catalogAtComboPack, combo.id);
        check(
          `combo cost snapshot = chosen-variant BOM cost (৳${chosenCost})`,
          Number(nItem.unitCostSnapshot) === chosenCost
        );
        check(
          `chosen cost ≠ default cost (৳${chosenCost} vs ৳${defaultCost})`,
          chosenCost !== defaultCost
        );
        const availAfterPack = packageAvailability(
          catalogAtComboPack,
          combo.id,
          picks
        );
        check(
          `packing 1 combo drops availability by exactly 1 (${availBefore} → ${availAfterPack})`,
          availBefore !== null && availAfterPack === availBefore - 1
        );

        // Handover + the §6m courier ladder with the DELIVERY approval-wait.
        const nShipment = await applyHandover(
          tx,
          {
            orderId: nOrder.id,
            courierId: courier.id,
            trackingNo: "VERIFY-TRACK-0003",
            handoverDate: new Date(),
            codAmount: Math.max(nDue, 0),
            expectedDelivery: null,
            note: null,
          },
          admin.id
        );
        const nLoadSync = async () =>
          (await tx.shipment.findUniqueOrThrow({
            where: { id: nShipment.id },
            include: shipmentForSyncInclude,
          })) as unknown as ShipmentForSync;
        const nShip = async () =>
          tx.shipment.findUniqueOrThrow({ where: { id: nShipment.id } });

        await ingestDeliveryStatus(tx, {
          shipment: await nLoadSync(),
          rawStatus: "pending",
          source: "WEBHOOK",
          rawPayload: { status: "pending" },
        });
        check(
          "combo parcel enters IN_TRANSIT on warehouse receive",
          (await dueOf(tx, nOrder.id)).status === "IN_TRANSIT"
        );
        await ingestDeliveryStatus(tx, {
          shipment: await nLoadSync(),
          rawStatus: "pending",
          source: "POLL",
          rawPayload: {
            status: "pending",
            rider: { name: "Combo Rider", phone: "01922222222" },
          },
        });
        check(
          "rider assigned (mock) → ASSIGNED",
          (await nShip()).courierStatus === "ASSIGNED"
        );
        await ingestDeliveryStatus(tx, {
          shipment: await nLoadSync(),
          rawStatus: "delivered_approval_pending",
          source: "WEBHOOK",
          rawPayload: { status: "delivered_approval_pending" },
        });
        check(
          "'delivered_approval_pending' keeps the order IN_TRANSIT (§6m)",
          (await dueOf(tx, nOrder.id)).status === "IN_TRANSIT"
        );
        check(
          "courier status = DELIVERY_APPROVAL_PENDING",
          (await nShip()).courierStatus === "DELIVERY_APPROVAL_PENDING"
        );
        await ingestDeliveryStatus(tx, {
          shipment: await nLoadSync(),
          rawStatus: "delivered",
          source: "WEBHOOK",
          rawPayload: { status: "delivered" },
        });
        const nDelivered = await nShip();
        check(
          "hub approval ('delivered') → order DELIVERED, deliveredAt stamped",
          (await dueOf(tx, nOrder.id)).status === "DELIVERED" &&
            nDelivered.deliveredAt !== null
        );

        // COD reconciliation still works at the end of the new chain.
        const codRes = await applyCodReceived(
          tx,
          [nShipment.id],
          new Date(),
          admin.id,
          wallet.id
        );
        check(
          `combo COD reconciled ৳${codRes.totalCod} (expected ৳${Math.max(nDue, 0)})`,
          codRes.reconciled === 1 && codRes.totalCod === Math.max(nDue, 0)
        );
        check(
          "combo due settled to ৳0 by COD payment",
          (await dueOf(tx, nOrder.id)).due === 0
        );
        await invariant(tx, variantOpt.productId, "after combo COD");
        if (nestedLeafId !== undefined) {
          await invariant(tx, nestedLeafId, "after combo COD (nested leaf)");
        }
        console.log("");

        // =====================================================================
        // 11. TRASH → RESTORE → PURGE (CORRECTIONS §6f, C10 item 4) — trash
        //     releases the reservation, restore re-reserves, and the 30-day
        //     cron purge picks ONLY expired rows (dry-run inside the rollback).
        // =====================================================================
        console.log("11. TRASH — release on trash, re-reserve on restore, 30-day purge");
        const teddyReservedBase = (
          await tx.product.findUniqueOrThrow({ where: { id: teddy.id } })
        ).reservedQty;
        const mkTrashOrder = (no: string) =>
          tx.order.create({
            data: {
              orderNo: no,
              customerId: customer.id,
              recipientName: "Trash Recipient",
              recipientPhoneBd: "01700000005",
              deliveryAddress: "trash addr, Dhaka",
              subtotal: 1600,
              totalAmount: 1600,
              dueAmount: 1600,
              codAmount: 1600,
              status: "CONFIRMED",
              salesExecutiveId: admin.id,
              items: {
                create: [
                  { itemType: "PRODUCT", productId: teddy.id, qty: 2, unitPrice: 800, lineTotal: 1600 },
                ],
              },
            },
          });
        const tOrder = await mkTrashOrder("GV-LIFECYCLE-0004");
        await syncReservations(tx, tOrder.id, admin.id);
        const reservedAfterConfirmT = (
          await tx.product.findUniqueOrThrow({ where: { id: teddy.id } })
        ).reservedQty;
        check(
          "trash-test order reserved +2 Teddy on confirm",
          reservedAfterConfirmT === teddyReservedBase + 2
        );
        const teddyOnHandT = (
          await tx.product.findUniqueOrThrow({ where: { id: teddy.id } })
        ).stockQty;

        // Trash — the route's transaction body: stamp deletedAt + release.
        await tx.order.update({
          where: { id: tOrder.id },
          data: { deletedAt: new Date(), deletedBy: admin.id },
        });
        await releaseOrderStock(tx, tOrder.id, admin.id, {
          restoreDeducted: false,
          reason: `Order ${tOrder.orderNo} trashed`,
        });
        const afterTrash = await tx.product.findUniqueOrThrow({
          where: { id: teddy.id },
        });
        check(
          "trash releases the reservation (back to baseline)",
          afterTrash.reservedQty === teddyReservedBase
        );
        check("trash leaves on-hand untouched", afterTrash.stockQty === teddyOnHandT);

        // Restore — the route's transaction body: clear deletedAt + re-sync.
        await tx.order.update({
          where: { id: tOrder.id },
          data: { deletedAt: null, deletedBy: null },
        });
        await syncReservations(tx, tOrder.id, admin.id);
        const afterRestore = await tx.product.findUniqueOrThrow({
          where: { id: teddy.id },
        });
        check(
          "restore re-reserves the order's stock (+2 again)",
          afterRestore.reservedQty === teddyReservedBase + 2
        );
        await invariant(tx, teddy.id, "after trash/restore round trip");

        // Purge dry-run — the cron's selection: ONLY rows trashed > 30 days.
        // Re-trash the order backdated 31 days, plus a fresh 5-day-old row that
        // must survive. Same cutoff arithmetic as the route.
        await tx.order.update({
          where: { id: tOrder.id },
          data: {
            deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
            deletedBy: admin.id,
          },
        });
        await releaseOrderStock(tx, tOrder.id, admin.id, {
          restoreDeducted: false,
          reason: `Order ${tOrder.orderNo} trashed`,
        });
        const freshTrash = await mkTrashOrder("GV-LIFECYCLE-0005");
        await tx.order.update({
          where: { id: freshTrash.id },
          data: {
            deletedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
            deletedBy: admin.id,
          },
        });
        const cutoff = new Date(
          Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
        );
        const expired = await tx.order.findMany({
          where: {
            deletedAt: { not: null, lt: cutoff },
            orderNo: { startsWith: "GV-LIFECYCLE-" },
          },
          select: { id: true, orderNo: true },
        });
        check(
          "purge selection picks the 31-day row and ONLY it",
          expired.length === 1 && expired[0].id === tOrder.id
        );

        // Execute the purge on the expired row (rolled back with everything
        // else): cascades take items/payments/history, the ledger stays.
        const ledgerRowsBefore = await tx.stockMovement.count({
          where: { refTable: "orders", refId: tOrder.id },
        });
        check("order has ledger rows before purge", ledgerRowsBefore > 0);
        await tx.order.delete({ where: { id: tOrder.id } });
        const [goneItems, goneHistory, keptLedger] = await Promise.all([
          tx.orderItem.count({ where: { orderId: tOrder.id } }),
          tx.orderStatusHistory.count({ where: { orderId: tOrder.id } }),
          tx.stockMovement.count({
            where: { refTable: "orders", refId: tOrder.id },
          }),
        ]);
        check(
          "purge cascades items + status history",
          goneItems === 0 && goneHistory === 0
        );
        check(
          "immutable stock ledger survives the purge",
          keptLedger === ledgerRowsBefore
        );
        await invariant(tx, teddy.id, "after purge dry-run");

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
