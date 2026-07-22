// Verification for CORRECTIONS Orders §R8 — Steadfast Payments sync (automatic
// COD payout reconciliation with NET collection accounting). The GET /payments*
// response shapes are not fully documented upstream, so every DB scenario runs
// on MOCKED payloads through the same defensive parser + ingest path the live
// sync uses. Mutating checks run inside a transaction that is ALWAYS rolled
// back — the DB is left untouched.
//
// Covered: parser shape tolerance · processing → paid transition · per-order
// GROSS due settlement vs NET dashboard collection · net + charges = gross
// reconcile identity (mocked + live-DB audit) · unmatched consignments ·
// replay idempotency · manual-reconcile overlap (estimate replaced, no double
// count) · per-parcel bill → courier_cost_actual.
//
// Run: npm run verify:steadfast-payments

import { prisma } from "../lib/db";
import { applyCodReceived } from "../lib/courier";
import {
  ingestSteadfastPayment,
  resolveSteadfastPaymentItem,
} from "../lib/steadfast-payments";
import {
  computeNetReceivable,
  findNextPage,
  normalizeSteadfastPaymentStatus,
  parsePaymentDetail,
  parsePaymentsList,
  paymentIdNumber,
  paymentReconciles,
  round2,
} from "../lib/steadfast-payments-constants";
import {
  COD_CHARGE_EXPENSE_CATEGORY,
  COURIER_DELIVERY_CHARGE_EXPENSE_CATEGORY,
} from "../lib/courier-constants";
import { STEADFAST_COURIER_NAME } from "../lib/steadfast-constants";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

class Rollback extends Error {}

const USER_ID = 1;
// Test ids far outside anything real (rolled back regardless).
const SF_PAYMENT_1 = 88_000_001;
const SF_PAYMENT_2 = 88_000_002;
const SF_PAYMENT_3 = 88_000_003;
const SF_PAYMENT_4 = 88_000_004;
const SF_PAYMENT_5 = 88_000_005;
const SF_PAYMENT_6 = 88_000_006;
const CID_BASE = 990_000_000;

async function main() {
  console.log("A. Defensive parser (undocumented shapes):");
  {
    // Laravel-style paginated envelope with the documented invoice fields.
    const listA = {
      status: 200,
      data: {
        current_page: 1,
        last_page: 2,
        data: [
          {
            id: 30699149,
            invoice_no: "SFC-30699149",
            status: "processing",
            payment_date: "2026-07-18 10:00:00",
            amount_delivered: 18300,
            payable_delivery_charge: 955,
            cod_charge: 173,
            net_amount: 17172,
            available_balance: 0,
            total_parcels: 4,
          },
        ],
      },
    };
    const a = parsePaymentsList(listA);
    check("paginated data.data envelope found", a.length === 1);
    check("id + invoice_no + status parsed", a[0]?.steadfastPaymentId === 30699149 && a[0]?.invoiceNo === "SFC-30699149" && a[0]?.status === "PROCESSING");
    check(
      "documented amounts parsed",
      a[0]?.amountDelivered === 18300 &&
        a[0]?.deliveryCharge === 955 &&
        a[0]?.codCharge === 173 &&
        a[0]?.netAmount === 17172 &&
        a[0]?.parcelCount === 4
    );
    check("findNextPage reads current/last page", findNextPage(listA) === 2);

    // A different spelling set: flat `payments` array, net derived from gross.
    const listB = {
      payments: [
        {
          payment_id: 777,
          invoice: "SFC-777",
          state: "Paid",
          created_at: "2026-07-17T09:30:00Z",
          total_cod: 10000,
          delivery_fee: 500,
          cod_fee: 100,
        },
      ],
    };
    const b = parsePaymentsList(listB);
    check("flat payments[] + alternate keys parsed", b.length === 1 && b[0]?.steadfastPaymentId === 777);
    check("'Paid' normalizes to PAID", b[0]?.status === "PAID");
    check(
      "missing net derived (gross − charges)",
      b[0]?.netAmount === 9400,
      String(b[0]?.netAmount)
    );
    check("findNextPage → null when unadvertised", findNextPage(listB) === null);

    const detail = parsePaymentDetail({
      status: 200,
      payment: {
        id: 777,
        invoice_no: "SFC-777",
        status: "paid",
        amount_delivered: 10000,
        payable_delivery_charge: 500,
        cod_charge: 100,
        net_amount: 9400,
      },
      consignments: [
        { consignment_id: 1001, invoice: "GV-0001", cod_amount: 5500, bill: 60, status: "delivered" },
        { consignment_id: 1002, invoice: "GV-0002", cod_amount: 4500, delivery_charge: 65 },
      ],
    });
    check("detail payment object found", detail.payment?.steadfastPaymentId === 777);
    check(
      "consignments parsed (bill AND delivery_charge spellings)",
      detail.consignments.length === 2 &&
        detail.consignments[0]?.deliveryCharge === 60 &&
        detail.consignments[1]?.deliveryCharge === 65
    );
    check(
      "per-parcel COD parsed",
      detail.consignments[0]?.codAmount === 5500 && detail.consignments[1]?.codAmount === 4500
    );

    check("normalize: unpaid → PROCESSING", normalizeSteadfastPaymentStatus("unpaid") === "PROCESSING");
    check("normalize: unknown → PROCESSING (no money on ambiguity)", normalizeSteadfastPaymentStatus("weird") === "PROCESSING");
    check(
      "reconcile identity holds on the example (17172 + 955 + 173 = 18300)",
      paymentReconciles({ amountDelivered: 18300, deliveryCharge: 955, codCharge: 173, netAmount: 17172 })
    );
    check(
      "reconcile identity fails on a broken invoice",
      !paymentReconciles({ amountDelivered: 18300, deliveryCharge: 955, codCharge: 173, netAmount: 17000 })
    );
  }

  console.log("\nA2. Round 2 §2.1 — the REAL production envelope (captured 2026-07-22):");
  {
    // GET /payments exactly as portal.packzy.com answered it (trimmed to 2 rows).
    const realList = {
      status: 1,
      alertClass: "success",
      message: "Fetched successfully!",
      payments: [
        {
          payment_id: "SFC-30803488",
          amount: 7000,
          method: "Bank",
          due_bills: 470,
          paid_bills: 0,
          charges: 159,
          total: 6371,
          status_label: "paid",
          created_at: "2026-07-20 05:20:49",
          ready_at: "2026-07-20 10:41:12",
          paid_at: "2026-07-20 10:53:50",
        },
        {
          payment_id: "SFC-30820783",
          amount: 2200,
          method: "Bank",
          due_bills: 135,
          paid_bills: 0,
          charges: 21,
          total: 2044,
          status_label: "paid",
          created_at: "2026-07-21 01:03:22",
          ready_at: "2026-07-21 10:40:20",
          paid_at: "2026-07-21 10:52:53",
        },
      ],
    };
    const real = parsePaymentsList(realList);
    check("real envelope: both rows parsed (was 0 before the fix)", real.length === 2);
    const r = real[1];
    check(
      'payment_id "SFC-30820783" → numeric id 30820783',
      r?.steadfastPaymentId === 30820783
    );
    check('invoice preserved as "SFC-30820783"', r?.invoiceNo === "SFC-30820783");
    check('status_label "paid" → PAID', r?.status === "PAID");
    check(
      "amount/due_bills/charges/total → gross/delivery/cod/net",
      r?.amountDelivered === 2200 &&
        r?.deliveryCharge === 135 &&
        r?.codCharge === 21 &&
        r?.netAmount === 2044
    );
    check(
      "real reconcile identity: 2044 + 135 + 21 = 2200",
      paymentReconciles({
        amountDelivered: 2200,
        deliveryCharge: 135,
        codCharge: 21,
        netAmount: 2044,
      })
    );
    check(
      '§2.5 paid_at "2026-07-21 10:52:53" parsed as Dhaka → 04:52:53Z',
      r?.paymentDate?.toISOString() === "2026-07-21T04:52:53.000Z"
    );
    check("real envelope advertises no next page", findNextPage(realList) === null);

    // GET /payments/{id} exactly as answered (one consignment kept).
    const realDetail = {
      status: 1,
      alertClass: "success",
      message: "Fetched successfully!",
      payment: {
        payment_id: "SFC-30820783",
        amount: 2200,
        method: "Bank",
        due_bills: 135,
        paid_bills: 0,
        charges: 21,
        total: 2044,
        status_label: "paid",
        created_at: "2026-07-21 01:03:22",
        ready_at: "2026-07-21 10:40:20",
        paid_at: "2026-07-21 10:52:53",
        consignments: [
          {
            consignment_id: 272145178,
            invoice: "",
            tracking_code: "SFR260716STE18E2F9BD",
            tracking_link:
              "https://steadfast.com.bd/tl/c1PGYDPqPPiOQ1PqvcFjIhtErmo4mbzO",
            recipient_name: "মহিমা",
            recipient_phone: "01882489534",
            recipient_address: "জেলা : লক্ষ্মীপুর, থানা: চন্দ্রগঞ্জ",
            recipient_email: null,
            alternative_phone: "01863508205",
            item_description: null,
            total_lot: 1,
            cod_amount: 2200,
            status: "delivered",
            note: "Katan silk sharee sky blue",
            created_at: "2026-07-16T14:34:17.000000Z",
            updated_at: "2026-07-20T19:03:22.000000Z",
          },
        ],
      },
    };
    const detail = parsePaymentDetail(realDetail);
    check(
      "real detail: payment found under `payment`",
      detail.payment?.steadfastPaymentId === 30820783 &&
        detail.payment?.netAmount === 2044
    );
    check(
      "real detail: consignment id + per-parcel COD + status parsed",
      detail.consignments.length === 1 &&
        detail.consignments[0]?.consignmentId === 272145178 &&
        detail.consignments[0]?.codAmount === 2200 &&
        detail.consignments[0]?.statusRaw === "delivered"
    );
    check(
      "real detail: blank invoice → null (panel-sent parcel)",
      detail.consignments[0]?.invoice === null
    );

    check("paymentIdNumber('SFC-30820783') → 30820783", paymentIdNumber("SFC-30820783") === 30820783);
    check("paymentIdNumber(30820783) → 30820783", paymentIdNumber(30820783) === 30820783);
    check("paymentIdNumber('no digits') → null", paymentIdNumber("no digits") === null);
    check("paymentIdNumber(null) → null", paymentIdNumber(null) === null);
  }

  console.log("\nA3. Round 2 §2.7 — net receivable math:");
  {
    // The spec's own example: 5,500 − 215 = 5,285; − 1% (52.85) = 5,232.15.
    const specExample = computeNetReceivable({
      codAmount: 5500,
      courierCostActual: 215,
      codFeePercent: 1,
    });
    check(
      "spec example: COD 5500 − 215 → fee 52.85 → net 5232.15",
      specExample.codFee === 52.85 &&
        specExample.deduction === 267.85 &&
        specExample.netReceivable === 5232.15 &&
        specExample.chargeKnown
    );
    // Real payout SFC-30820783: 2200 − 135 = 2065 → 1% = 20.65 ≈ their 21tk.
    const real = computeNetReceivable({
      codAmount: 2200,
      courierCostActual: 135,
      codFeePercent: 1,
    });
    check(
      "real payout math: 2200 − 135 − 20.65 = 2044.35 (≈ their 2044 within tolerance)",
      real.netReceivable === 2044.35 && Math.abs(real.netReceivable - 2044) <= 2
    );
    const estimated = computeNetReceivable({
      codAmount: 2000,
      courierCostActual: null,
      courierCostEstimated: 135,
      codFeePercent: 1,
    });
    check(
      "estimate fallback when SF actual unknown (marked as such)",
      estimated.deliveryCharge === 135 && !estimated.chargeKnown
    );
    const bare = computeNetReceivable({ codAmount: 1000, codFeePercent: 1 });
    check(
      "no charge data → deduction is the fee alone",
      bare.deliveryCharge === 0 && bare.codFee === 10 && bare.netReceivable === 990
    );
    const halfPct = computeNetReceivable({
      codAmount: 1000,
      courierCostActual: 100,
      codFeePercent: 0.5,
    });
    check(
      "courier row's fee % honored (0.5% → 4.50)",
      halfPct.codFee === 4.5 && halfPct.netReceivable === 895.5
    );
  }

  console.log("\nB. Ingest scenarios on mocked payloads (rolled back):");
  const courier = await prisma.courier.findUnique({
    where: { name: STEADFAST_COURIER_NAME },
    select: { id: true },
  });
  if (!courier) throw new Error("Steadfast courier row missing — seed first");

  const orders = await prisma.order.findMany({
    where: { dueAmount: { gt: 0 }, shipment: { is: null } },
    orderBy: { id: "asc" },
    take: 3,
    select: { id: true, orderNo: true, dueAmount: true },
  });
  if (orders.length < 3) {
    throw new Error("Need 3 orders with due > 0 and no shipment to test with");
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const [o1, o2, o3] = orders;
        const due1 = Number(o1.dueAmount);
        const due2 = Number(o2.dueAmount);
        const due3 = Number(o3.dueAmount);

        // Wallet the payouts deposit into (created here, rolled back with the rest).
        const wallet = await tx.wallet.create({
          data: { name: "VERIFY-R8 payout wallet", type: "BANK" },
        });

        // Delivered, unreconciled Steadfast shipments with known consignment ids.
        const mkShipment = (orderId: number, cid: number, cod: number) =>
          tx.shipment.create({
            data: {
              orderId,
              courierId: courier.id,
              handoverDate: now,
              codAmount: cod,
              status: "DELIVERED",
              deliveredAt: now,
              consignmentId: BigInt(cid),
              createdBy: USER_ID,
              updatedBy: USER_ID,
            },
          });
        const s1 = await mkShipment(o1.id, CID_BASE + 1, due1);
        const s2 = await mkShipment(o2.id, CID_BASE + 2, due2);
        const s3 = await mkShipment(o3.id, CID_BASE + 3, due3);

        // Invoice P1 covers parcels 1+2 with the real per-parcel figures.
        const gross = round2(due1 + due2);
        const deliveryCharge = 125; // 60 + 65
        const codCharge = round2(gross * 0.01);
        const net = round2(gross - deliveryCharge - codCharge);
        const consignmentsP1 = [
          { consignmentId: CID_BASE + 1, invoice: o1.orderNo, codAmount: due1, deliveryCharge: 60, statusRaw: "delivered", raw: { consignment_id: CID_BASE + 1 } },
          { consignmentId: CID_BASE + 2, invoice: o2.orderNo, codAmount: due2, deliveryCharge: 65, statusRaw: "delivered", raw: { consignment_id: CID_BASE + 2 } },
        ];
        const parsedP1 = (status: "PROCESSING" | "PAID") => ({
          steadfastPaymentId: SF_PAYMENT_1,
          invoiceNo: "SFC-VERIFY-1",
          statusRaw: status.toLowerCase(),
          status,
          paymentDate: now,
          amountDelivered: gross,
          deliveryCharge,
          codCharge,
          netAmount: net,
          availableBalance: 0,
          parcelCount: 2,
          raw: { id: SF_PAYMENT_1, status: status.toLowerCase() },
        });

        // ── processing: record + items stored, NO money moves ──
        const r1 = await ingestSteadfastPayment(tx, {
          parsed: parsedP1("PROCESSING"),
          consignments: consignmentsP1,
          detailRaw: { verify: "detail-1" },
          walletId: wallet.id,
          userId: USER_ID,
          now,
        });
        check("processing: record created", r1.created && !r1.becamePaid);
        const afterProcessing = await tx.steadfastPayment.findUniqueOrThrow({
          where: { steadfastPaymentId: BigInt(SF_PAYMENT_1) },
          include: { items: true },
        });
        check("processing: raw list + detail payloads stored (first sight)", afterProcessing.rawPayload != null && afterProcessing.rawDetailPayload != null);
        check("processing: 2 consignment items stored & matched", afterProcessing.items.length === 2 && afterProcessing.items.every((i) => i.shipmentId != null));
        const codRowsBefore = await tx.payment.count({
          where: { orderId: { in: [o1.id, o2.id] }, type: "COD_COURIER" },
        });
        check("processing: NO COD payment rows yet", codRowsBefore === 0);
        check("processing: no expenses, not reconciled", afterProcessing.reconciledAt == null && afterProcessing.deliveryChargeExpenseId == null && afterProcessing.codChargeExpenseId == null);

        // ── the processing → paid transition fires the money exactly once ──
        const r2 = await ingestSteadfastPayment(tx, {
          parsed: parsedP1("PAID"),
          consignments: consignmentsP1,
          walletId: wallet.id,
          userId: USER_ID,
          now,
        });
        check("paid: becamePaid + reconciled on transition", r2.becamePaid && r2.reconciledNow);
        check("paid: both orders settled", r2.ordersSettled === 2 && r2.matched === 2 && r2.unmatched === 0);

        // GROSS due settlement: each order got its FULL per-parcel COD.
        const p1Rows = await tx.payment.findMany({
          where: { orderId: { in: [o1.id, o2.id] }, type: "COD_COURIER" },
          orderBy: { orderId: "asc" },
        });
        check(
          "per-order payment rows are GROSS (full per-parcel COD)",
          p1Rows.length === 2 &&
            round2(p1Rows.reduce((s, p) => s + Number(p.amount), 0)) === gross,
          `rows=${p1Rows.length} sum=${p1Rows.reduce((s, p) => s + Number(p.amount), 0)}`
        );
        check("payment rows carry the payout wallet + verified", p1Rows.every((p) => p.walletId === wallet.id && p.isVerified));
        const duesAfter = await tx.order.findMany({
          where: { id: { in: [o1.id, o2.id] } },
          select: { dueAmount: true },
        });
        check("dues settle to 0 (gross against due)", duesAfter.every((o) => Number(o.dueAmount) === 0));

        const s1After = await tx.shipment.findUniqueOrThrow({ where: { id: s1.id } });
        const s2After = await tx.shipment.findUniqueOrThrow({ where: { id: s2.id } });
        check("cod_received set on both shipments", s1After.codReceived && s2After.codReceived);
        check(
          "per-parcel bill → courier_cost_actual (real replaces estimate)",
          Number(s1After.courierCostActual) === 60 && Number(s2After.courierCostActual) === 65,
          `${s1After.courierCostActual}/${s2After.courierCostActual}`
        );

        // The two REAL charge expenses, once, from the payout wallet.
        const paidRecord = await tx.steadfastPayment.findUniqueOrThrow({
          where: { steadfastPaymentId: BigInt(SF_PAYMENT_1) },
        });
        const expenses = await tx.expense.findMany({
          where: { refTable: "steadfast_payments", refId: paidRecord.id },
          include: { category: true },
        });
        const deliveryExpense = expenses.find(
          (e) => e.category.name === COURIER_DELIVERY_CHARGE_EXPENSE_CATEGORY
        );
        const codExpense = expenses.find(
          (e) => e.category.name === COD_CHARGE_EXPENSE_CATEGORY
        );
        check(
          "\"Courier Delivery Charge\" expense = invoice's real number",
          deliveryExpense != null && Number(deliveryExpense.amount) === deliveryCharge
        );
        check(
          "\"COD Charge\" expense = invoice's real number",
          codExpense != null && Number(codExpense.amount) === codCharge
        );
        check("both expenses draw from the payout wallet", expenses.every((e) => e.walletId === wallet.id));

        // NET wallet deposit: in − out over the payout wallet = the net amount.
        const [wIn, wOut] = await Promise.all([
          tx.payment.aggregate({
            where: { walletId: wallet.id, type: { not: "REFUND" }, isRejected: false },
            _sum: { amount: true },
          }),
          tx.expense.aggregate({ where: { walletId: wallet.id }, _sum: { amount: true } }),
        ]);
        const walletNet = round2(Number(wIn._sum.amount ?? 0) - Number(wOut._sum.amount ?? 0));
        check(
          "wallet running balance moves by exactly the NET payout",
          walletNet === net,
          `wallet=${walletNet} net=${net}`
        );
        check(
          "reconcile identity on the stored record (net + charges = gross)",
          paymentReconciles({
            amountDelivered: Number(paidRecord.amountDelivered),
            deliveryCharge: Number(paidRecord.deliveryCharge),
            codCharge: Number(paidRecord.codCharge),
            netAmount: Number(paidRecord.netAmount),
          })
        );

        // ── replay idempotency: same paid payload again → zero new effects ──
        const expenseCount = await tx.expense.count({
          where: { refTable: "steadfast_payments", refId: paidRecord.id },
        });
        const r3 = await ingestSteadfastPayment(tx, {
          parsed: parsedP1("PAID"),
          consignments: consignmentsP1,
          walletId: wallet.id,
          userId: USER_ID,
          now,
        });
        const p1RowsReplay = await tx.payment.count({
          where: { orderId: { in: [o1.id, o2.id] }, type: "COD_COURIER" },
        });
        const expenseCountReplay = await tx.expense.count({
          where: { refTable: "steadfast_payments", refId: paidRecord.id },
        });
        check(
          "replay: no new payment rows, no new expenses, nothing settled",
          !r3.becamePaid &&
            !r3.reconciledNow &&
            r3.ordersSettled === 0 &&
            p1RowsReplay === 2 &&
            expenseCountReplay === expenseCount
        );

        // ── unmatched consignments → stored, flagged, no money ──
        const r4 = await ingestSteadfastPayment(tx, {
          parsed: {
            steadfastPaymentId: SF_PAYMENT_2,
            invoiceNo: "SFC-VERIFY-2",
            statusRaw: "paid",
            status: "PAID",
            paymentDate: now,
            amountDelivered: 999,
            deliveryCharge: 50,
            codCharge: 10,
            netAmount: 939,
            availableBalance: null,
            parcelCount: 1,
            raw: {},
          },
          consignments: [
            { consignmentId: CID_BASE + 777, invoice: "NOT-OURS-1", codAmount: 999, deliveryCharge: 50, statusRaw: "delivered", raw: {} },
          ],
          walletId: wallet.id,
          userId: USER_ID,
          now,
        });
        const p2Items = await tx.steadfastPaymentItem.findMany({
          where: { payment: { steadfastPaymentId: BigInt(SF_PAYMENT_2) } },
        });
        check(
          "unmatched consignment stored with null shipment (flagged for review)",
          r4.unmatched === 1 && r4.matched === 0 && p2Items.length === 1 && p2Items[0].shipmentId == null
        );
        check("unmatched: no order settled, no COD recorded", r4.ordersSettled === 0 && r4.codRecorded === 0);
        // Round 2 §2.1 — a payout whose consignments aren't (all) ours must NOT
        // post the payment-level charge expenses: the live account still gets
        // payouts for panel-sent parcels the software never saw, and booking
        // their charges would pit expenses against income that never arrives.
        const p2Record = await tx.steadfastPayment.findUniqueOrThrow({
          where: { steadfastPaymentId: BigInt(SF_PAYMENT_2) },
        });
        const p2Expenses = await tx.expense.count({
          where: { refTable: "steadfast_payments", refId: p2Record.id },
        });
        check(
          "§2.1 foreign payout: NO charge expenses, not reconciled",
          !r4.reconciledNow &&
            p2Expenses === 0 &&
            p2Record.reconciledAt == null &&
            p2Record.deliveryChargeExpenseId == null &&
            p2Record.codChargeExpenseId == null
        );

        // ── manual-reconcile overlap: estimate replaced, counted once ──
        await tx.courier.update({
          where: { id: courier.id },
          data: { codFeePercent: 1 }, // ensure the manual flow posts its estimated fee
        });
        const manual = await applyCodReceived(tx, [s3.id], now, USER_ID, null);
        const s3Manual = await tx.shipment.findUniqueOrThrow({ where: { id: s3.id } });
        check(
          "setup: manual reconcile posted its ESTIMATED fee expense",
          manual.reconciled === 1 && s3Manual.codFeeExpenseId != null
        );
        const manualRow = await tx.payment.findFirstOrThrow({
          where: { orderId: o3.id, type: "COD_COURIER" },
          orderBy: { id: "desc" },
        });

        const gross3 = due3;
        const cod3 = round2(gross3 * 0.01);
        const r5 = await ingestSteadfastPayment(tx, {
          parsed: {
            steadfastPaymentId: SF_PAYMENT_3,
            invoiceNo: "SFC-VERIFY-3",
            statusRaw: "paid",
            status: "PAID",
            paymentDate: now,
            amountDelivered: gross3,
            deliveryCharge: 70,
            codCharge: cod3,
            netAmount: round2(gross3 - 70 - cod3),
            availableBalance: null,
            parcelCount: 1,
            raw: {},
          },
          consignments: [
            { consignmentId: CID_BASE + 3, invoice: o3.orderNo, codAmount: gross3, deliveryCharge: 70, statusRaw: "delivered", raw: {} },
          ],
          walletId: wallet.id,
          userId: USER_ID,
          now,
        });
        const codRowsO3 = await tx.payment.count({
          where: { orderId: o3.id, type: "COD_COURIER" },
        });
        const s3After = await tx.shipment.findUniqueOrThrow({ where: { id: s3.id } });
        const estimateGone =
          (await tx.expense.findUnique({ where: { id: s3Manual.codFeeExpenseId! } })) == null;
        check(
          "already-reconciled parcel skipped (no second payment row)",
          r5.ordersSettled === 0 && codRowsO3 === 1
        );
        check(
          "estimated per-shipment fee expense replaced by the invoice's real COD charge",
          r5.estimatesReplaced === 1 && s3After.codFeeExpenseId == null && estimateGone
        );
        const p3Item = await tx.steadfastPaymentItem.findFirstOrThrow({
          where: { payment: { steadfastPaymentId: BigInt(SF_PAYMENT_3) } },
        });
        check(
          "manual COD row adopted as the item's payment link (dashboard counts it once)",
          p3Item.orderPaymentId === manualRow.id
        );

        // ── the dashboard's NET Courier-COD line, replicated in-tx ──
        // (buildOwnerDashboard runs on the global client, so the formula is
        // recomputed here over the same queries it uses.)
        const from = new Date(now.getTime() - 60_000);
        const to = new Date(now.getTime() + 60_000);
        const [sfAgg, codAgg, linkedAgg] = await Promise.all([
          tx.steadfastPayment.aggregate({
            where: { status: "PAID", paymentDate: { gte: from, lte: to } },
            _sum: { netAmount: true, amountDelivered: true, deliveryCharge: true, codCharge: true },
          }),
          tx.payment.aggregate({
            where: {
              paymentDate: { gte: from, lte: to },
              type: "COD_COURIER",
              isRejected: false,
              order: { deletedAt: null },
            },
            _sum: { amount: true },
          }),
          tx.payment.aggregate({
            where: {
              paymentDate: { gte: from, lte: to },
              type: "COD_COURIER",
              isRejected: false,
              order: { deletedAt: null },
              steadfastPaymentItems: { some: {} },
            },
            _sum: { amount: true },
          }),
        ]);
        const netSf = round2(Number(sfAgg._sum.netAmount ?? 0));
        const manualCod = Math.max(
          0,
          round2(Number(codAgg._sum.amount ?? 0) - Number(linkedAgg._sum.amount ?? 0))
        );
        const expectedNet = round2(
          net + 939 + round2(gross3 - 70 - cod3) // P1 + P2 + P3 net amounts
        );
        check(
          "dashboard Courier-COD line = NET payouts (gross rows all payout-linked)",
          netSf === expectedNet && manualCod === 0,
          `netSf=${netSf} expected=${expectedNet} manual=${manualCod}`
        );
        check(
          "dashboard breakdown ties: gross − charges = net across payouts",
          round2(
            Number(sfAgg._sum.amountDelivered ?? 0) -
              Number(sfAgg._sum.deliveryCharge ?? 0) -
              Number(sfAgg._sum.codCharge ?? 0)
          ) === netSf
        );

        // ══ Round 2 §2.7 — the justification + auto-COMPLETE engine ══
        console.log("\n  §2.7 payout justification (match / mismatch / resolve):");
        const customer27 = await tx.customer.findFirstOrThrow({
          select: { id: true },
        });
        const mkOrder = (orderNo: string, amount: number, due = amount) =>
          tx.order.create({
            data: {
              orderNo,
              customerId: customer27.id,
              recipientName: "Verify §2.7",
              recipientPhoneBd: "01712345678",
              deliveryAddress: "House 1, Road 2",
              district: "Dhaka",
              thana: "Dhanmondi",
              subtotal: amount,
              totalAmount: amount,
              dueAmount: due,
              codAmount: due,
              status: "DELIVERED",
              salesExecutiveId: USER_ID,
            },
          });
        const mk27Shipment = (
          orderId: number,
          cid: number,
          cod: number,
          actual: number | null
        ) =>
          tx.shipment.create({
            data: {
              orderId,
              courierId: courier.id,
              handoverDate: now,
              codAmount: cod,
              status: "DELIVERED",
              deliveredAt: now,
              consignmentId: BigInt(cid),
              ...(actual != null ? { courierCostActual: actual } : {}),
              createdBy: USER_ID,
              updatedBy: USER_ID,
            },
          });

        // ── D1: MATCH → auto-COMPLETE (the spec's own example numbers) ──
        const o4 = await mkOrder("GV-SFP27-0001", 5500);
        await mk27Shipment(o4.id, CID_BASE + 4, 5500, 215);
        const r6 = await ingestSteadfastPayment(tx, {
          parsed: {
            steadfastPaymentId: SF_PAYMENT_4,
            invoiceNo: "SFC-VERIFY-4",
            statusRaw: "paid",
            status: "PAID",
            paymentDate: now,
            amountDelivered: 5500,
            deliveryCharge: 215,
            codCharge: 52.85,
            netAmount: 5232.15,
            availableBalance: null,
            parcelCount: 1,
            raw: {},
          },
          consignments: [
            { consignmentId: CID_BASE + 4, invoice: null, codAmount: 5500, deliveryCharge: null, statusRaw: "delivered", raw: {} },
          ],
          walletId: wallet.id,
          userId: USER_ID,
          codFeePercent: 1,
          now,
        });
        const o4After = await tx.order.findUniqueOrThrow({ where: { id: o4.id } });
        const p4Item = await tx.steadfastPaymentItem.findFirstOrThrow({
          where: { payment: { steadfastPaymentId: BigInt(SF_PAYMENT_4) } },
        });
        const p4Record = await tx.steadfastPayment.findUniqueOrThrow({
          where: { steadfastPaymentId: BigInt(SF_PAYMENT_4) },
        });
        check(
          "match: order settled at gross + auto-COMPLETED (due 0)",
          r6.ordersSettled === 1 &&
            r6.completed === 1 &&
            o4After.status === "COMPLETED" &&
            Number(o4After.dueAmount) === 0
        );
        check(
          "match: verdict MATCHED, expected net 5232.15 = paid net (spec math)",
          p4Item.reconcileStatus === "MATCHED" &&
            Number(p4Item.expectedNet) === 5232.15 &&
            Number(p4Item.paidNet) === 5232.15
        );
        check(
          "match: auto-complete wrote order_status_history",
          (await tx.orderStatusHistory.count({
            where: { orderId: o4.id, toStatus: "COMPLETED" },
          })) === 1
        );
        check(
          "match: payout finalized — expenses posted + reconciled",
          r6.reconciledNow &&
            p4Record.reconciledAt != null &&
            p4Record.deliveryChargeExpenseId != null &&
            p4Record.codChargeExpenseId != null
        );

        // ── D2: MISMATCH (their 3000 vs our 5000) → discrepancy → resolve ──
        const o5 = await mkOrder("GV-SFP27-0002", 5000);
        const s5 = await mk27Shipment(o5.id, CID_BASE + 5, 5000, 135);
        const parsed5 = {
          steadfastPaymentId: SF_PAYMENT_5,
          invoiceNo: "SFC-VERIFY-5",
          statusRaw: "paid",
          status: "PAID" as const,
          paymentDate: now,
          amountDelivered: 3000,
          deliveryCharge: 135,
          codCharge: 28.65,
          netAmount: 2836.35,
          availableBalance: null,
          parcelCount: 1,
          raw: {},
        };
        const consignments5 = [
          { consignmentId: CID_BASE + 5, invoice: null, codAmount: 3000, deliveryCharge: null, statusRaw: "delivered", raw: {} },
        ];
        const r7 = await ingestSteadfastPayment(tx, {
          parsed: parsed5,
          consignments: consignments5,
          walletId: wallet.id,
          userId: USER_ID,
          codFeePercent: 1,
          now,
        });
        const p5ItemQ = () =>
          tx.steadfastPaymentItem.findFirstOrThrow({
            where: { payment: { steadfastPaymentId: BigInt(SF_PAYMENT_5) } },
          });
        const p5RecordQ = () =>
          tx.steadfastPayment.findUniqueOrThrow({
            where: { steadfastPaymentId: BigInt(SF_PAYMENT_5) },
          });
        let p5 = await p5ItemQ();
        const o5Mid = await tx.order.findUniqueOrThrow({ where: { id: o5.id } });
        const s5Mid = await tx.shipment.findUniqueOrThrow({ where: { id: s5.id } });
        check(
          "mismatch: flagged MISMATCH, nothing settles",
          r7.discrepancies === 1 &&
            r7.ordersSettled === 0 &&
            p5.reconcileStatus === "MISMATCH" &&
            p5.orderPaymentId == null
        );
        check(
          "mismatch: order stays DELIVERED with full due, shipment ⚠, COD open",
          o5Mid.status === "DELIVERED" &&
            Number(o5Mid.dueAmount) === 5000 &&
            s5Mid.needsAttention &&
            !s5Mid.codReceived
        );
        check(
          "mismatch: payout NOT finalized (no expenses, not reconciled)",
          (await p5RecordQ()).reconciledAt == null &&
            (await tx.expense.count({
              where: { refTable: "steadfast_payments", refId: r7.paymentRecordId },
            })) === 0
        );

        const r8 = await ingestSteadfastPayment(tx, {
          parsed: parsed5,
          consignments: consignments5,
          walletId: wallet.id,
          userId: USER_ID,
          codFeePercent: 1,
          now,
        });
        check(
          "mismatch replay: idempotent (still no money moved)",
          r8.ordersSettled === 0 &&
            (await tx.payment.count({
              where: { orderId: o5.id, type: "COD_COURIER" },
            })) === 0
        );

        let acceptNoNoteBlocked = false;
        try {
          await resolveSteadfastPaymentItem(tx, {
            itemId: p5.id,
            action: "ACCEPT",
            note: "   ",
            userId: USER_ID,
            walletId: wallet.id,
            now,
          });
        } catch {
          acceptNoNoteBlocked = true;
        }
        check("resolve: accept WITHOUT a reason → blocked", acceptNoNoteBlocked);

        const disputeOutcome = await resolveSteadfastPaymentItem(tx, {
          itemId: p5.id,
          action: "DISPUTE",
          note: "raised with SF support",
          userId: USER_ID,
          walletId: wallet.id,
          now,
        });
        p5 = await p5ItemQ();
        check(
          "resolve: dispute → DISPUTED with note, no money",
          disputeOutcome.reconcileStatus === "DISPUTED" &&
            p5.reconcileStatus === "DISPUTED" &&
            p5.resolveNote === "raised with SF support" &&
            (await tx.payment.count({
              where: { orderId: o5.id, type: "COD_COURIER" },
            })) === 0
        );

        const acceptOutcome = await resolveSteadfastPaymentItem(tx, {
          itemId: p5.id,
          action: "ACCEPT",
          note: "partial delivery — SF collected 3000",
          userId: USER_ID,
          walletId: wallet.id,
          now,
        });
        p5 = await p5ItemQ();
        const o5After = await tx.order.findUniqueOrThrow({ where: { id: o5.id } });
        const s5After = await tx.shipment.findUniqueOrThrow({ where: { id: s5.id } });
        check(
          "resolve: accept → THEIR 3000 posts, due 2000 remains",
          acceptOutcome.settled &&
            Number(o5After.dueAmount) === 2000 &&
            p5.reconcileStatus === "ACCEPTED" &&
            p5.orderPaymentId != null
        );
        check(
          "resolve: shipment COD closed + ⚠ cleared; order NOT completed (due left)",
          s5After.codReceived &&
            !s5After.needsAttention &&
            !acceptOutcome.completed &&
            o5After.status === "DELIVERED"
        );
        check(
          "resolve: payout finalizes once every consignment is justified",
          acceptOutcome.paymentReconciled && (await p5RecordQ()).reconciledAt != null
        );

        const r9 = await ingestSteadfastPayment(tx, {
          parsed: parsed5,
          consignments: consignments5,
          walletId: wallet.id,
          userId: USER_ID,
          codFeePercent: 1,
          now,
        });
        p5 = await p5ItemQ();
        check(
          "post-accept replay: ACCEPTED sticks, no duplicate payment rows",
          r9.ordersSettled === 0 &&
            r9.discrepancies === 0 &&
            p5.reconcileStatus === "ACCEPTED" &&
            (await tx.payment.count({
              where: { orderId: o5.id, type: "COD_COURIER" },
            })) === 1
        );

        // ── D3: COD edited to 0 (customer paid bKash) — the real prod case ──
        const o6 = await mkOrder("GV-SFP27-0003", 4000, 0);
        await mk27Shipment(o6.id, CID_BASE + 6, 0, 135);
        const r10 = await ingestSteadfastPayment(tx, {
          parsed: {
            steadfastPaymentId: SF_PAYMENT_6,
            invoiceNo: "SFC-VERIFY-6",
            statusRaw: "paid",
            status: "PAID",
            paymentDate: now,
            amountDelivered: 0,
            deliveryCharge: 135,
            codCharge: 0,
            netAmount: -135,
            availableBalance: null,
            parcelCount: 1,
            raw: {},
          },
          consignments: [
            { consignmentId: CID_BASE + 6, invoice: null, codAmount: 0, deliveryCharge: null, statusRaw: "delivered", raw: {} },
          ],
          walletId: wallet.id,
          userId: USER_ID,
          codFeePercent: 1,
          now,
        });
        const o6After = await tx.order.findUniqueOrThrow({ where: { id: o6.id } });
        check(
          "zero-COD parcel (bKash-paid): MATCHED, no payment row, still auto-COMPLETED",
          r10.completed === 1 &&
            o6After.status === "COMPLETED" &&
            (await tx.payment.count({
              where: { orderId: o6.id, type: "COD_COURIER" },
            })) === 0
        );

        throw new Rollback();
      },
      { timeout: 120_000, maxWait: 15_000 }
    );
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  console.log("\n(transaction rolled back — DB unchanged)");

  console.log("\nC. Live-DB reconcile audit (read-only, real payout rows):");
  {
    const paid = await prisma.steadfastPayment.findMany({ where: { status: "PAID" } });
    const broken = paid.filter(
      (p) =>
        !paymentReconciles({
          amountDelivered: Number(p.amountDelivered),
          deliveryCharge: Number(p.deliveryCharge),
          codCharge: Number(p.codCharge),
          netAmount: Number(p.netAmount),
        })
    );
    check(
      `every stored PAID payout reconciles (${paid.length} on record)`,
      broken.length === 0,
      broken.map((p) => p.invoiceNo ?? String(p.steadfastPaymentId)).join(", ")
    );
    // Each posted charge expense must equal the stored invoice figure.
    let expenseMismatch = 0;
    for (const p of paid) {
      for (const [expenseId, amount] of [
        [p.deliveryChargeExpenseId, Number(p.deliveryCharge)],
        [p.codChargeExpenseId, Number(p.codCharge)],
      ] as const) {
        if (expenseId == null) continue;
        const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
        if (!expense || Number(expense.amount) !== amount) expenseMismatch += 1;
      }
    }
    check("posted charge expenses match the stored invoice figures", expenseMismatch === 0);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
