import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { recomputeDue, dhakaDateBound } from "./orders";
import { getSystemUserId } from "./system-user";
import { requireEnabledSteadfast } from "./steadfast-integration";
import { getPayments, getPaymentDetail } from "./steadfast";
import { getSteadfastPayoutWalletId } from "./settings";
import {
  COURIER_DELIVERY_CHARGE_EXPENSE_CATEGORY,
  COD_CHARGE_EXPENSE_CATEGORY,
} from "./courier-constants";
import {
  findNextPage,
  parsePaymentsList,
  parsePaymentDetail,
  round2,
  type ParsedPaymentConsignment,
  type ParsedSteadfastPayment,
  type SteadfastPaymentDetailRow,
} from "./steadfast-payments-constants";

// ============ CORRECTIONS Orders §R8 — Steadfast payments sync ============
//
// The single place a Steadfast payout becomes Gift Valy money. The hourly cron,
// the Courier-page "Sync payments" button and the dashboard widget's refresh
// icon all run runSteadfastPaymentsSync, which fetches GET /payments (+ details)
// and routes every payment through ingestSteadfastPayment — one transaction per
// payment, network strictly outside transactions (§5 pattern).
//
// Accounting (the owner's NET-collection decision):
//   • per-ORDER payment rows stay GROSS — each cleared consignment creates a
//     COD_COURIER payment for its full per-parcel COD, settling the customer's
//     due correctly (the customer DID pay the full COD; Steadfast deducted its
//     charges before remitting). Never net against a due.
//   • the payable delivery charge and the ~1% COD fee post ONCE per paid
//     payment as real-number expenses ("Courier Delivery Charge" / "COD
//     Charge", ref = the steadfast_payments row).
//   • payment rows + both expenses carry the configured payout wallet, so the
//     wallet's running balance (in − out, lib/reports.ts §9.3) moves by exactly
//     the NET deposit — and net + charges = gross reconciles by construction.
//
// Idempotency (replay-safe): payments/items upsert by their Steadfast ids; a
// shipment already cod_received is skipped (its item keeps order_payment_id
// null); the two expenses are guarded by their *ExpenseId columns. Re-ingesting
// a paid payment is a no-op; a processing → paid transition fires the money
// side effects exactly once.

const DETAIL_FETCHES_PER_RUN = 10; // stay gentle on their API
const MAX_PAYMENT_PAGES = 3;
// The §R8 "hourly poller" — the */15 status cron hosts the payments sync but
// only runs it when the last one is at least this old.
export const PAYMENTS_SYNC_MIN_GAP_MS = 60 * 60 * 1000;

export interface PaymentIngestOutcome {
  paymentRecordId: number;
  created: boolean; // first time we saw this payment
  becamePaid: boolean; // processing → paid on THIS ingest
  reconciledNow: boolean; // paid-side effects ran for the first time
  ordersSettled: number; // COD_COURIER payment rows created
  codRecorded: number; // ৳ recorded on orders (gross)
  matched: number; // consignments matched to our shipments
  unmatched: number; // consignments we don't recognize (flagged list)
  estimatesReplaced: number; // per-shipment estimated COD-fee expenses removed
}

export interface PaymentsSyncSummary {
  payments: number; // payment records seen in the list
  created: number;
  paidTransitions: number;
  ordersSettled: number;
  codRecorded: number;
  unmatched: number;
  detailsFetched: number;
  errors: { steadfastPaymentId: number | null; error: string }[];
}

// One cleared consignment resolved against our data.
interface MatchedConsignment {
  parsed: ParsedPaymentConsignment;
  shipment: {
    id: number;
    codReceived: boolean;
    codFeeExpenseId: number | null;
    codAmount: Prisma.Decimal;
    status: string;
    order: { id: number; orderNo: string; dueAmount: Prisma.Decimal };
  } | null;
}

async function expenseCategoryId(
  tx: Prisma.TransactionClient,
  name: string
): Promise<number> {
  const category = await tx.expenseCategory.upsert({
    where: { name },
    update: {},
    create: { name, costType: "VARIABLE" },
  });
  return category.id;
}

// Match the invoice's consignments to our shipments: consignment_id first
// (unique on shipments), their invoice (= our order_no) as fallback.
async function matchConsignments(
  tx: Prisma.TransactionClient,
  consignments: ParsedPaymentConsignment[]
): Promise<MatchedConsignment[]> {
  const cids = consignments
    .map((c) => c.consignmentId)
    .filter((v): v is number => v != null);
  const invoices = consignments
    .map((c) => c.invoice)
    .filter((v): v is string => v != null);

  const select = {
    id: true,
    codReceived: true,
    codFeeExpenseId: true,
    codAmount: true,
    status: true,
    consignmentId: true,
    order: { select: { id: true, orderNo: true, dueAmount: true } },
  } satisfies Prisma.ShipmentSelect;

  const [byCid, byInvoice] = await Promise.all([
    cids.length
      ? tx.shipment.findMany({
          where: { consignmentId: { in: cids.map(BigInt) } },
          select,
        })
      : [],
    invoices.length
      ? tx.shipment.findMany({
          where: { order: { orderNo: { in: invoices } } },
          select,
        })
      : [],
  ]);
  const cidMap = new Map(byCid.map((s) => [Number(s.consignmentId), s]));
  const invoiceMap = new Map(byInvoice.map((s) => [s.order.orderNo, s]));

  return consignments.map((parsed) => ({
    parsed,
    shipment:
      (parsed.consignmentId != null ? cidMap.get(parsed.consignmentId) : undefined) ??
      (parsed.invoice != null ? invoiceMap.get(parsed.invoice) : undefined) ??
      null,
  }));
}

export async function ingestSteadfastPayment(
  tx: Prisma.TransactionClient,
  args: {
    parsed: ParsedSteadfastPayment;
    // null/undefined = no detail fetched this run (list-only refresh).
    consignments?: ParsedPaymentConsignment[] | null;
    detailRaw?: unknown;
    walletId: number | null;
    userId: number;
    now?: Date;
  }
): Promise<PaymentIngestOutcome> {
  const { parsed } = args;
  const now = args.now ?? new Date();

  const existing = await tx.steadfastPayment.findUnique({
    where: { steadfastPaymentId: BigInt(parsed.steadfastPaymentId) },
    include: { items: { select: { id: true, consignmentId: true, invoice: true } } },
  });

  // Once PAID, never downgraded — a stale list page can't un-pay a payout.
  const status =
    existing?.status === "PAID" ? "PAID" : parsed.status;
  const becamePaid =
    status === "PAID" && (existing ? existing.status !== "PAID" : true);

  const amounts = {
    invoiceNo: parsed.invoiceNo ?? existing?.invoiceNo ?? null,
    amountDelivered:
      parsed.amountDelivered ?? Number(existing?.amountDelivered ?? 0),
    deliveryCharge: parsed.deliveryCharge ?? Number(existing?.deliveryCharge ?? 0),
    codCharge: parsed.codCharge ?? Number(existing?.codCharge ?? 0),
    netAmount: parsed.netAmount ?? Number(existing?.netAmount ?? 0),
    availableBalance:
      parsed.availableBalance ??
      (existing?.availableBalance != null ? Number(existing.availableBalance) : null),
  };

  const record = existing
    ? await tx.steadfastPayment.update({
        where: { id: existing.id },
        data: {
          ...amounts,
          status,
          paymentDate: parsed.paymentDate ?? existing.paymentDate,
          paidAt: existing.paidAt ?? (status === "PAID" ? now : null),
          // First-seen payloads are kept verbatim (shape discovery); only fill
          // the detail once.
          ...(existing.rawDetailPayload == null && args.detailRaw !== undefined
            ? { rawDetailPayload: args.detailRaw as Prisma.InputJsonValue }
            : {}),
        },
      })
    : await tx.steadfastPayment.create({
        data: {
          steadfastPaymentId: BigInt(parsed.steadfastPaymentId),
          ...amounts,
          status,
          paymentDate: parsed.paymentDate ?? now,
          paidAt: status === "PAID" ? now : null,
          rawPayload: (parsed.raw ?? {}) as Prisma.InputJsonValue,
          ...(args.detailRaw !== undefined
            ? { rawDetailPayload: args.detailRaw as Prisma.InputJsonValue }
            : {}),
        },
      });

  const outcome: PaymentIngestOutcome = {
    paymentRecordId: record.id,
    created: !existing,
    becamePaid,
    reconciledNow: false,
    ordersSettled: 0,
    codRecorded: 0,
    matched: 0,
    unmatched: 0,
    estimatesReplaced: 0,
  };

  // ---- consignment items (only when a detail payload is on hand) ----
  if (args.consignments && args.consignments.length > 0) {
    const matched = await matchConsignments(tx, args.consignments);
    for (const { parsed: c, shipment } of matched) {
      const data = {
        invoice: c.invoice,
        codAmount: round2(c.codAmount ?? Number(shipment?.codAmount ?? 0)),
        deliveryCharge: c.deliveryCharge != null ? round2(c.deliveryCharge) : null,
        status: c.statusRaw,
        shipmentId: shipment?.id ?? null,
        orderId: shipment?.order.id ?? null,
        rawPayload: (c.raw ?? {}) as Prisma.InputJsonValue,
      };
      if (c.consignmentId != null) {
        await tx.steadfastPaymentItem.upsert({
          where: {
            paymentId_consignmentId: {
              paymentId: record.id,
              consignmentId: BigInt(c.consignmentId),
            },
          },
          update: data,
          create: {
            paymentId: record.id,
            consignmentId: BigInt(c.consignmentId),
            ...data,
          },
        });
      } else {
        // No consignment id in the payload — dedupe by invoice so replays
        // don't multiply rows.
        const prior = c.invoice
          ? await tx.steadfastPaymentItem.findFirst({
              where: { paymentId: record.id, consignmentId: null, invoice: c.invoice },
              select: { id: true },
            })
          : null;
        if (prior) {
          await tx.steadfastPaymentItem.update({ where: { id: prior.id }, data });
        } else {
          await tx.steadfastPaymentItem.create({
            data: { paymentId: record.id, consignmentId: null, ...data },
          });
        }
      }
    }
    await tx.steadfastPayment.update({
      where: { id: record.id },
      data: {
        parcelCount: Math.max(parsed.parcelCount ?? 0, matched.length),
      },
    });
  }

  // ---- paid-side effects (idempotent, re-checked on every PAID ingest so a
  // late-matched consignment still reconciles) ----
  if (status === "PAID") {
    const items = await tx.steadfastPaymentItem.findMany({
      where: { paymentId: record.id },
      include: {
        shipment: {
          select: {
            id: true,
            codReceived: true,
            codFeeExpenseId: true,
            status: true,
            codAmount: true,
            order: { select: { id: true, orderNo: true, dueAmount: true } },
          },
        },
      },
    });
    outcome.matched = items.filter((i) => i.shipmentId != null).length;
    outcome.unmatched = items.length - outcome.matched;

    const receivedDate = record.paymentDate ?? now;
    for (const item of items) {
      const shipment = item.shipment;
      if (!shipment) continue;

      // The invoice's per-parcel bill is the authoritative delivery charge —
      // it replaces webhook/tracking-page estimates in courier_cost_actual.
      if (item.deliveryCharge != null && Number(item.deliveryCharge) > 0) {
        await tx.shipment.update({
          where: { id: shipment.id },
          data: {
            courierCostActual: round2(Number(item.deliveryCharge)),
            updatedBy: args.userId,
          },
        });
      }

      if (!shipment.codReceived) {
        // GROSS due settlement: the per-parcel COD from the payload (fallback:
        // the shipment's recorded COD), capped at the outstanding due so a
        // stray payload figure can never drive a due negative.
        const gross = round2(
          item.codAmount != null && Number(item.codAmount) > 0
            ? Number(item.codAmount)
            : Number(shipment.codAmount)
        );
        const due = Number(shipment.order.dueAmount);
        const payAmount = round2(Math.min(gross, Math.max(due, 0)));
        let orderPaymentId: number | null = null;
        if (payAmount > 0) {
          const payment = await tx.payment.create({
            data: {
              orderId: shipment.order.id,
              paymentDate: receivedDate,
              type: "COD_COURIER",
              method: "COURIER_COD",
              amount: payAmount,
              walletId: args.walletId,
              isVerified: true, // the payout invoice IS the statement line
              verifiedBy: args.userId,
              createdBy: args.userId,
              updatedBy: args.userId,
            },
          });
          orderPaymentId = payment.id;
          await recomputeDue(tx, shipment.order.id);
        }
        await tx.shipment.update({
          where: { id: shipment.id },
          data: {
            codReceived: true,
            codReceivedAt: receivedDate,
            // A payout for a parcel our books don't show as delivered means our
            // status lagged (missed webhook / manual gap) — flag it, never move
            // the order behind the operator's back.
            ...(shipment.status !== "DELIVERED" ? { needsAttention: true } : {}),
            updatedBy: args.userId,
          },
        });
        await tx.steadfastPaymentItem.update({
          where: { id: item.id },
          data: { orderPaymentId },
        });
        outcome.ordersSettled += 1;
        outcome.codRecorded = round2(outcome.codRecorded + payAmount);
      } else if (item.orderPaymentId == null) {
        // Manually pre-reconciled parcel now covered by a real payout — the
        // skip keeps it idempotent, but two corrections make the books true:
        // 1. adopt the existing manual COD row as this item's payment link, so
        //    the dashboard's payout-vs-manual split counts the parcel ONCE
        //    (as net, via the payout) instead of net + manual gross;
        // 2. the payment-level COD Charge below carries its REAL fee, so the
        //    manual flow's ESTIMATED per-shipment fee expense would double-
        //    count — replace the estimate with the invoice's number by
        //    removing it.
        const manualRow = await tx.payment.findFirst({
          where: {
            orderId: shipment.order.id,
            type: "COD_COURIER",
            isRejected: false,
          },
          orderBy: { id: "desc" },
          select: { id: true },
        });
        if (manualRow) {
          await tx.steadfastPaymentItem.update({
            where: { id: item.id },
            data: { orderPaymentId: manualRow.id },
          });
        }
        if (shipment.codFeeExpenseId != null) {
          await tx.expense.delete({ where: { id: shipment.codFeeExpenseId } });
          await tx.shipment.update({
            where: { id: shipment.id },
            data: { codFeeExpenseId: null, updatedBy: args.userId },
          });
          outcome.estimatesReplaced += 1;
        }
      }
    }

    // Payment-level real-number expenses — once per payout, guarded by the id
    // columns. Both draw from the payout wallet so the wallet nets to NET.
    const expenseDate = dhakaDateBound(receivedDate);
    const label = amounts.invoiceNo ?? `#${parsed.steadfastPaymentId}`;
    let deliveryChargeExpenseId = record.deliveryChargeExpenseId;
    if (deliveryChargeExpenseId == null && amounts.deliveryCharge > 0) {
      const expense = await tx.expense.create({
        data: {
          expenseDate,
          categoryId: await expenseCategoryId(
            tx,
            COURIER_DELIVERY_CHARGE_EXPENSE_CATEGORY
          ),
          amount: round2(amounts.deliveryCharge),
          walletId: args.walletId,
          notes: `Steadfast payout ${label} — delivery charge`,
          refTable: "steadfast_payments",
          refId: record.id,
          createdBy: args.userId,
          updatedBy: args.userId,
        },
      });
      deliveryChargeExpenseId = expense.id;
    }
    let codChargeExpenseId = record.codChargeExpenseId;
    if (codChargeExpenseId == null && amounts.codCharge > 0) {
      const expense = await tx.expense.create({
        data: {
          expenseDate,
          categoryId: await expenseCategoryId(tx, COD_CHARGE_EXPENSE_CATEGORY),
          amount: round2(amounts.codCharge),
          walletId: args.walletId,
          notes: `Steadfast payout ${label} — COD charge`,
          refTable: "steadfast_payments",
          refId: record.id,
          createdBy: args.userId,
          updatedBy: args.userId,
        },
      });
      codChargeExpenseId = expense.id;
    }

    outcome.reconciledNow = record.reconciledAt == null;
    await tx.steadfastPayment.update({
      where: { id: record.id },
      data: {
        deliveryChargeExpenseId,
        codChargeExpenseId,
        reconciledAt: record.reconciledAt ?? now,
        walletId: record.walletId ?? args.walletId,
      },
    });
  }

  return outcome;
}

// ---------- the poll: GET /payments (+ details) → ingest ----------

export async function runSteadfastPaymentsSync(opts?: {
  userId?: number;
}): Promise<PaymentsSyncSummary> {
  const { integration, creds } = await requireEnabledSteadfast();
  const walletId = await getSteadfastPayoutWalletId();
  const userId = opts?.userId ?? (await getSystemUserId(prisma));

  const summary: PaymentsSyncSummary = {
    payments: 0,
    created: 0,
    paidTransitions: 0,
    ordersSettled: 0,
    codRecorded: 0,
    unmatched: 0,
    detailsFetched: 0,
    errors: [],
  };

  // Page 1 always; follow advertised pagination a couple of pages at most
  // (payouts are weekly-ish — the recent window is what reconciliation needs).
  const parsed: ParsedSteadfastPayment[] = [];
  let page = 1;
  for (let i = 0; i < MAX_PAYMENT_PAGES; i++) {
    let raw: unknown;
    try {
      raw = await getPayments(creds, page);
    } catch (e) {
      summary.errors.push({
        steadfastPaymentId: null,
        error: e instanceof Error ? e.message : "GET /payments failed",
      });
      break;
    }
    const batch = parsePaymentsList(raw);
    parsed.push(...batch);
    const next = findNextPage(raw);
    if (!next || batch.length === 0) break;
    page = next;
  }
  summary.payments = parsed.length;

  for (const p of parsed) {
    try {
      const existing = await prisma.steadfastPayment.findUnique({
        where: { steadfastPaymentId: BigInt(p.steadfastPaymentId) },
        select: {
          id: true,
          status: true,
          reconciledAt: true,
          rawDetailPayload: true,
          items: { where: { shipmentId: null }, select: { id: true }, take: 1 },
        },
      });

      // Fetch the invoice detail when we've never seen it, the status moved,
      // or a paid payout still has unreconciled/unmatched work — capped per run.
      const statusMoved = existing != null && existing.status !== p.status;
      const wantsDetail =
        !existing ||
        existing.rawDetailPayload == null ||
        statusMoved ||
        (p.status === "PAID" &&
          (existing.reconciledAt == null || existing.items.length > 0));
      let detailRaw: unknown;
      let consignments: ParsedPaymentConsignment[] | null = null;
      if (wantsDetail && summary.detailsFetched < DETAIL_FETCHES_PER_RUN) {
        summary.detailsFetched += 1;
        detailRaw = await getPaymentDetail(creds, p.steadfastPaymentId);
        const detail = parsePaymentDetail(detailRaw);
        consignments = detail.consignments;
        // The detail is usually fuller than the list row — prefer its figures.
        if (detail.payment && detail.payment.steadfastPaymentId === p.steadfastPaymentId) {
          for (const key of [
            "invoiceNo",
            "paymentDate",
            "amountDelivered",
            "deliveryCharge",
            "codCharge",
            "netAmount",
            "availableBalance",
            "parcelCount",
          ] as const) {
            if (detail.payment[key] != null) {
              (p as unknown as Record<string, unknown>)[key] = detail.payment[key];
            }
          }
        }
      }

      const outcome = await prisma.$transaction((tx) =>
        ingestSteadfastPayment(tx, {
          parsed: p,
          consignments,
          detailRaw,
          walletId,
          userId,
        })
      );
      if (outcome.created) summary.created += 1;
      if (outcome.becamePaid) summary.paidTransitions += 1;
      summary.ordersSettled += outcome.ordersSettled;
      summary.codRecorded = round2(summary.codRecorded + outcome.codRecorded);
      summary.unmatched += outcome.unmatched;

      await new Promise((r) => setTimeout(r, 150)); // §5 gentle pacing
    } catch (e) {
      summary.errors.push({
        steadfastPaymentId: p.steadfastPaymentId,
        error: e instanceof Error ? e.message : "payment ingest failed",
      });
    }
  }

  await prisma.courierIntegration.update({
    where: { id: integration.id },
    data: { lastPaymentsSyncAt: new Date() },
  });

  return summary;
}

// ---------- serialization (Courier page + detail route) ----------

export type SteadfastPaymentWithItems = Prisma.SteadfastPaymentGetPayload<{
  include: {
    items: {
      include: { order: { select: { id: true; orderNo: true } } };
    };
  };
}>;

export function serializeSteadfastPayment(
  p: SteadfastPaymentWithItems
): SteadfastPaymentDetailRow {
  const gross = Number(p.amountDelivered);
  const delivery = Number(p.deliveryCharge);
  const cod = Number(p.codCharge);
  const net = Number(p.netAmount);
  const matchedCount = p.items.filter((i) => i.shipmentId != null).length;
  return {
    id: p.id,
    steadfastPaymentId: Number(p.steadfastPaymentId),
    invoiceNo: p.invoiceNo,
    status: p.status,
    paymentDate: p.paymentDate.toISOString(),
    amountDelivered: gross,
    deliveryCharge: delivery,
    codCharge: cod,
    netAmount: net,
    parcelCount: p.parcelCount || p.items.length,
    matchedCount,
    unmatchedCount: p.items.length - matchedCount,
    reconciles: Math.abs(gross - (net + delivery + cod)) <= 0.02,
    items: p.items.map((i) => ({
      id: i.id,
      consignmentId: i.consignmentId != null ? Number(i.consignmentId) : null,
      invoice: i.invoice,
      codAmount: Number(i.codAmount),
      deliveryCharge: i.deliveryCharge != null ? Number(i.deliveryCharge) : null,
      orderId: i.order?.id ?? null,
      orderNo: i.order?.orderNo ?? null,
      matched: i.shipmentId != null,
      settled: i.orderPaymentId != null,
    })),
  };
}
