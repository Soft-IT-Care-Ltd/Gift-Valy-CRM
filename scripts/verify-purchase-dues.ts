// Supplier-credit / purchase-dues verification (SPEC §6.3). Drives Paid, Due and
// Partial purchases + due-payment settlement inside ONE rolled-back transaction,
// asserting the core rule: a purchase's COST is expensed only for cash actually
// paid (never on the due), each payment reduces the paying wallet, and stock +
// weighted-avg update on receipt regardless of payment.
import { PrismaClient, type Prisma } from "@prisma/client";
import { applyPurchase } from "../lib/stock";
import {
  purchasePaidAmount,
  recordPurchasePayment,
  buildPurchaseDues,
} from "../lib/purchases";
import { AuthzError } from "../lib/authz";

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

// Σ expenses posted from a wallet (the outflow the wallet balance subtracts).
async function walletExpenseOut(tx: Prisma.TransactionClient, walletId: number) {
  const agg = await tx.expense.aggregate({
    where: { walletId },
    _sum: { amount: true },
  });
  return round2(Number(agg._sum.amount ?? 0));
}

async function purchaseExpenseCount(tx: Prisma.TransactionClient, purchaseId: number) {
  return tx.expense.count({ where: { refTable: "purchases", refId: purchaseId } });
}

async function statusOf(tx: Prisma.TransactionClient, purchaseId: number) {
  return (
    await tx.purchase.findUniqueOrThrow({
      where: { id: purchaseId },
      select: { paymentStatus: true, dueDate: true },
    })
  );
}

async function main() {
  console.log("Purchase dues verification — cash-based expense + wallet outflow\n");

  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { name: "Admin" } },
  });
  const product = await prisma.product.findUniqueOrThrow({ where: { sku: "GV-0004" } });
  const wallet = await prisma.wallet.findFirstOrThrow({ where: { isActive: true } });
  const wallet2 = await prisma.wallet.findFirstOrThrow({
    where: { isActive: true, id: { not: wallet.id } },
  });

  const UNIT = 300;
  const QTY = 10;
  const TOTAL = UNIT * QTY; // 3000

  console.log(
    `Product ${product.name}: on-hand ${product.stockQty}, avg ৳${product.avgCost}`
  );
  console.log(`Wallets: pay from "${wallet.name}", second "${wallet2.name}"\n`);

  try {
    await prisma.$transaction(
      async (tx) => {
        // ---- 1. PAID purchase: full expense today, wallet −total, no due ----
        console.log("1. PAID — pay the full total from a wallet at entry");
        const stockBefore = product.stockQty;
        const avgBefore = Number(product.avgCost);
        const walletOutBefore = await walletExpenseOut(tx, wallet.id);
        const paidPurchase = await applyPurchase(tx, {
          supplierName: "Paid Supplier",
          purchaseDate: new Date(),
          paidAmount: TOTAL,
          walletId: wallet.id,
          notes: "paid in full",
          lines: [{ productId: product.id, qty: QTY, unitCost: UNIT }],
          userId: admin.id,
        });
        const paidStock = await tx.product.findUniqueOrThrow({ where: { id: product.id } });
        check(
          `stock rose ${stockBefore} → ${paidStock.stockQty} (+${QTY})`,
          paidStock.stockQty === stockBefore + QTY
        );
        check(
          "weighted-avg recomputed on receipt (paid or not)",
          Number(paidStock.avgCost) ===
            round2((Math.max(stockBefore, 0) * avgBefore + QTY * UNIT) / (Math.max(stockBefore, 0) + QTY))
        );
        check("status PAID", (await statusOf(tx, paidPurchase.id)).paymentStatus === "PAID");
        check("no due date on a paid purchase", (await statusOf(tx, paidPurchase.id)).dueDate === null);
        check(
          `paid amount = total (৳${await purchasePaidAmount(tx, paidPurchase.id)})`,
          (await purchasePaidAmount(tx, paidPurchase.id)) === TOTAL
        );
        check("one expense row for the full total", (await purchaseExpenseCount(tx, paidPurchase.id)) === 1);
        check(
          `wallet outflow +৳${TOTAL}`,
          (await walletExpenseOut(tx, wallet.id)) === round2(walletOutBefore + TOTAL)
        );
        console.log("");

        // ---- 2. DUE purchase: NO expense, wallet unchanged, appears in dues ----
        console.log("2. DUE — bought on credit, nothing paid at entry");
        const walletOutBeforeDue = await walletExpenseOut(tx, wallet.id);
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 7);
        const duePurchase = await applyPurchase(tx, {
          supplierName: "Credit Supplier",
          purchaseDate: new Date(),
          paidAmount: 0,
          walletId: null,
          dueDate,
          notes: "on credit",
          lines: [{ productId: product.id, qty: QTY, unitCost: UNIT }],
          userId: admin.id,
        });
        const dueStock = await tx.product.findUniqueOrThrow({ where: { id: product.id } });
        check(
          `stock still rose on a due purchase (+${QTY})`,
          dueStock.stockQty === paidStock.stockQty + QTY
        );
        check("status DUE", (await statusOf(tx, duePurchase.id)).paymentStatus === "DUE");
        check("due date stored", (await statusOf(tx, duePurchase.id)).dueDate !== null);
        check("NO expense posted for a due purchase", (await purchaseExpenseCount(tx, duePurchase.id)) === 0);
        check("paid amount = 0", (await purchasePaidAmount(tx, duePurchase.id)) === 0);
        check(
          "wallet outflow unchanged by a due purchase",
          (await walletExpenseOut(tx, wallet.id)) === walletOutBeforeDue
        );
        console.log("");

        // ---- 3. PARTIAL purchase: expense = paid, wallet −paid, remaining due ----
        console.log("3. PARTIAL — pay part at entry, rest becomes a due");
        const PARTIAL = 1200;
        const walletOutBeforePartial = await walletExpenseOut(tx, wallet.id);
        const partialPurchase = await applyPurchase(tx, {
          supplierName: "Partial Supplier",
          purchaseDate: new Date(),
          paidAmount: PARTIAL,
          walletId: wallet.id,
          dueDate,
          notes: "part paid",
          lines: [{ productId: product.id, qty: QTY, unitCost: UNIT }],
          userId: admin.id,
        });
        check("status PARTIAL", (await statusOf(tx, partialPurchase.id)).paymentStatus === "PARTIAL");
        check(
          `paid = ৳${PARTIAL}, expense posted once`,
          (await purchasePaidAmount(tx, partialPurchase.id)) === PARTIAL &&
            (await purchaseExpenseCount(tx, partialPurchase.id)) === 1
        );
        check(
          `wallet outflow +৳${PARTIAL} (only the paid part)`,
          (await walletExpenseOut(tx, wallet.id)) === round2(walletOutBeforePartial + PARTIAL)
        );
        console.log("");

        // ---- 4. Settle the partial's remaining due (partial → final) ----
        console.log("4. SETTLE — pay the remaining due down (partial then final)");
        const remaining = round2(TOTAL - PARTIAL); // 1800
        // over-payment rejected
        let overRejected = false;
        try {
          await recordPurchasePayment(
            tx,
            { purchaseId: partialPurchase.id, amount: remaining + 1, walletId: wallet2.id, paymentDate: new Date() },
            admin.id
          );
        } catch (e) {
          overRejected = e instanceof AuthzError;
        }
        check("over-payment rejected", overRejected);

        // partial settlement of 800 from wallet2
        const w2OutBefore = await walletExpenseOut(tx, wallet2.id);
        await recordPurchasePayment(
          tx,
          { purchaseId: partialPurchase.id, amount: 800, walletId: wallet2.id, paymentDate: new Date() },
          admin.id
        );
        check(
          "partial settlement keeps status PARTIAL",
          (await statusOf(tx, partialPurchase.id)).paymentStatus === "PARTIAL"
        );
        check(
          "settlement expense hit the chosen wallet (+৳800)",
          (await walletExpenseOut(tx, wallet2.id)) === round2(w2OutBefore + 800)
        );
        check(
          `paid now ৳${PARTIAL + 800}`,
          (await purchasePaidAmount(tx, partialPurchase.id)) === PARTIAL + 800
        );

        // final settlement of the last 1000 clears it
        const res = await recordPurchasePayment(
          tx,
          { purchaseId: partialPurchase.id, amount: 1000, walletId: wallet2.id, paymentDate: new Date() },
          admin.id
        );
        check("final settlement returns status PAID", res.status === "PAID");
        check("due now ৳0", res.due === 0);
        check(
          "purchase fully paid",
          (await purchasePaidAmount(tx, partialPurchase.id)) === TOTAL
        );
        check("due date cleared once settled", (await statusOf(tx, partialPurchase.id)).dueDate === null);
        // paying a settled purchase is refused
        let settledRejected = false;
        try {
          await recordPurchasePayment(
            tx,
            { purchaseId: partialPurchase.id, amount: 1, walletId: wallet2.id, paymentDate: new Date() },
            admin.id
          );
        } catch (e) {
          settledRejected = e instanceof AuthzError;
        }
        check("paying an already-settled purchase is refused", settledRejected);
        console.log("");

        // ---- 5. Due list reflects only the still-outstanding purchase ----
        console.log("5. DUE LIST — only the unpaid bill remains outstanding");
        const dues = await buildPurchaseDues(tx);
        const dueRow = dues.rows.find((r) => r.id === duePurchase.id);
        const paidRow = dues.rows.find((r) => r.id === paidPurchase.id);
        const partialRow = dues.rows.find((r) => r.id === partialPurchase.id);
        check("paid purchase not in dues", !paidRow);
        check("settled partial not in dues", !partialRow);
        check(`due purchase listed with due ৳${TOTAL}`, dueRow?.due === TOTAL);
        check("due purchase not overdue (7 days out)", dueRow?.overdue === false);
        check(
          "totalOutstanding includes the due purchase",
          dues.totalOutstanding >= TOTAL
        );

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
