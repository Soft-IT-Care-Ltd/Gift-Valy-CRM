import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AuthzError } from "./authz";
import { applyStatusTransition, recomputeDue } from "./orders";
import { releaseOrderStock } from "./stock";
import { COURIER_EXPENSE_CATEGORY } from "./courier-constants";

// ============ SPEC §7 — the courier & delivery engine ============
//
// A Shipment is created at courier handover (PACKED → HANDED_TO_COURIER) and its
// status drives the order status through the shared order lifecycle
// (applyStatusTransition), so order_status_history and the stock hooks stay the
// single source of truth. Two money side-effects auto-post as "Courier Charge"
// expenses (§9.1): the COD remittance fee at reconciliation and the return
// courier charge at return approval. Both are idempotent (guarded by the
// *ExpenseId columns) so re-running never double-charges.

const round2 = (n: number) => Math.round(n * 100) / 100;

// Shared "Courier Charge" expense category (VARIABLE), created on demand like
// the purchase category in lib/stock.ts.
async function courierExpenseCategoryId(tx: Prisma.TransactionClient): Promise<number> {
  const category = await tx.expenseCategory.upsert({
    where: { name: COURIER_EXPENSE_CATEGORY },
    update: {},
    create: { name: COURIER_EXPENSE_CATEGORY, costType: "VARIABLE" },
  });
  return category.id;
}

// ---------- handover: create shipment + move order to HANDED_TO_COURIER ----------

export interface HandoverInput {
  orderId: number;
  courierId: number;
  trackingNo: string | null;
  handoverDate: Date;
  codAmount: number;
  expectedDelivery: Date | null;
  note: string | null;
}

export async function applyHandover(
  tx: Prisma.TransactionClient,
  input: HandoverInput,
  userId: number
) {
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, status: true, cancelReason: true, shipment: { select: { id: true } } },
  });
  if (!order) throw new AuthzError(404, "Order not found");
  if (order.shipment) {
    throw new AuthzError(400, "This order already has a shipment");
  }
  if (order.status !== "PACKED") {
    throw new AuthzError(
      400,
      `Only PACKED orders can be handed over — this order is ${order.status}`
    );
  }
  const courier = await tx.courier.findUnique({
    where: { id: input.courierId },
    select: { id: true, isActive: true },
  });
  if (!courier) throw new AuthzError(400, "Courier not found");
  if (!courier.isActive) throw new AuthzError(400, "Courier is inactive");

  const shipment = await tx.shipment.create({
    data: {
      orderId: input.orderId,
      courierId: input.courierId,
      trackingNo: input.trackingNo,
      handoverDate: input.handoverDate,
      codAmount: round2(input.codAmount),
      expectedDelivery: input.expectedDelivery,
      status: "HANDED_TO_COURIER",
      createdBy: userId,
      updatedBy: userId,
    },
  });
  await applyStatusTransition(
    tx,
    { id: order.id, status: order.status, cancelReason: order.cancelReason },
    "HANDED_TO_COURIER",
    userId,
    input.note
  );
  return shipment;
}

// ---------- status update: sync shipment ↔ order (SPEC §7) ----------

export interface ShipmentStatusInput {
  to: "IN_TRANSIT" | "DELIVERED" | "RETURNED";
  note: string | null;
  courierCostActual?: number | null;
}

export async function applyShipmentStatus(
  tx: Prisma.TransactionClient,
  shipmentId: number,
  input: ShipmentStatusInput,
  userId: number
) {
  const shipment = await tx.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      order: { select: { id: true, status: true, cancelReason: true } },
    },
  });
  if (!shipment) throw new AuthzError(404, "Shipment not found");

  const now = new Date();
  await tx.shipment.update({
    where: { id: shipmentId },
    data: {
      status: input.to,
      deliveredAt: input.to === "DELIVERED" ? now : shipment.deliveredAt,
      returnedAt: input.to === "RETURNED" ? now : shipment.returnedAt,
      courierCostActual:
        input.courierCostActual === undefined
          ? undefined
          : input.courierCostActual === null
            ? null
            : round2(input.courierCostActual),
      updatedBy: userId,
    },
  });

  // RETURNED restores stock only after Admin approval (§1.3), so skip the stock
  // hook here; every other courier stage is stock-neutral.
  await applyStatusTransition(
    tx,
    shipment.order,
    input.to,
    userId,
    input.note,
    { skipStockSync: input.to === "RETURNED" }
  );
  return shipment;
}

// ---------- COD reconciliation (SPEC §7): bulk "mark COD received" ----------

export interface CodReconcileResult {
  reconciled: number;
  totalCod: number;
  totalFee: number;
  skipped: { shipmentId: number; reason: string }[];
}

// For each delivered shipment: record the COD collection as a payment (settling
// the order's remaining due) and auto-post the courier's COD fee as an expense.
// Both steps are idempotent — a shipment already marked received is skipped.
export async function applyCodReceived(
  tx: Prisma.TransactionClient,
  shipmentIds: number[],
  receivedDate: Date,
  userId: number
): Promise<CodReconcileResult> {
  const result: CodReconcileResult = {
    reconciled: 0,
    totalCod: 0,
    totalFee: 0,
    skipped: [],
  };
  let categoryId: number | null = null;

  for (const shipmentId of shipmentIds) {
    const shipment = await tx.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        courier: { select: { name: true, codFeePercent: true } },
        order: { select: { id: true, orderNo: true, dueAmount: true } },
      },
    });
    if (!shipment) {
      result.skipped.push({ shipmentId, reason: "not found" });
      continue;
    }
    if (shipment.status !== "DELIVERED") {
      result.skipped.push({ shipmentId, reason: "not delivered" });
      continue;
    }
    if (shipment.codReceived) {
      result.skipped.push({ shipmentId, reason: "already reconciled" });
      continue;
    }

    const codAmount = Number(shipment.codAmount);
    const due = Number(shipment.order.dueAmount);
    // Settle the order's outstanding due up to the COD collected (never overpay).
    const payAmount = round2(Math.min(codAmount, Math.max(due, 0)));
    if (payAmount > 0) {
      await tx.payment.create({
        data: {
          orderId: shipment.order.id,
          paymentDate: receivedDate,
          type: "COD_COURIER",
          method: "COURIER_COD",
          amount: payAmount,
          isVerified: true,
          verifiedBy: userId,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await recomputeDue(tx, shipment.order.id);
    }

    // Courier COD fee → auto-expense (§7 / §9.1), linked by ref so it is never
    // double-entered.
    const fee = round2((codAmount * Number(shipment.courier.codFeePercent)) / 100);
    let feeExpenseId: number | null = shipment.codFeeExpenseId;
    if (fee > 0 && feeExpenseId === null) {
      categoryId ??= await courierExpenseCategoryId(tx);
      const expense = await tx.expense.create({
        data: {
          expenseDate: receivedDate,
          categoryId,
          amount: fee,
          notes: `COD fee — ${shipment.courier.name} — ${shipment.order.orderNo}`,
          refTable: "shipments",
          refId: shipment.id,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      feeExpenseId = expense.id;
    }

    await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        codReceived: true,
        codReceivedAt: receivedDate,
        codFeeExpenseId: feeExpenseId,
        updatedBy: userId,
      },
    });
    result.reconciled += 1;
    result.totalCod = round2(result.totalCod + codAmount);
    result.totalFee = round2(result.totalFee + fee);
  }
  return result;
}

// ---------- return approval (SPEC §1.3): restore stock + return charge ----------

export interface ReturnApprovalInput {
  returnCharge: number;
  note: string | null;
}

export async function applyReturnApproval(
  tx: Prisma.TransactionClient,
  shipmentId: number,
  input: ReturnApprovalInput,
  userId: number
) {
  const shipment = await tx.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      courier: { select: { name: true } },
      order: { select: { id: true, orderNo: true } },
    },
  });
  if (!shipment) throw new AuthzError(404, "Shipment not found");
  if (shipment.status !== "RETURNED") {
    throw new AuthzError(400, "Only a returned shipment can be approved");
  }
  if (shipment.returnApproved) {
    throw new AuthzError(400, "This return is already approved");
  }

  // Restore whatever the ledger says the order still holds as deducted (§6.3).
  await releaseOrderStock(tx, shipment.order.id, userId, {
    restoreDeducted: true,
    reason: input.note
      ? `Return approved: ${input.note}`
      : "Return approved — stock restored",
  });

  const charge = round2(input.returnCharge);
  let expenseId: number | null = shipment.returnChargeExpenseId;
  if (charge > 0 && expenseId === null) {
    const categoryId = await courierExpenseCategoryId(tx);
    const expense = await tx.expense.create({
      data: {
        expenseDate: new Date(),
        categoryId,
        amount: charge,
        notes: `Return charge — ${shipment.courier.name} — ${shipment.order.orderNo}`,
        refTable: "shipments",
        refId: shipment.id,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    expenseId = expense.id;
  }

  await tx.shipment.update({
    where: { id: shipment.id },
    data: {
      returnApproved: true,
      returnApprovedAt: new Date(),
      returnApprovedBy: userId,
      returnCharge: charge > 0 ? charge : null,
      returnChargeExpenseId: expenseId,
      updatedBy: userId,
    },
  });
  return shipment;
}

// ---------- serialization ----------

export type CourierWithZones = Prisma.CourierGetPayload<{
  include: { zoneCharges: true; _count: { select: { shipments: true } } };
}>;

export function serializeCourier(c: CourierWithZones) {
  return {
    id: c.id,
    name: c.name,
    contact: c.contact,
    codFeePercent: Number(c.codFeePercent),
    notes: c.notes,
    isActive: c.isActive,
    shipmentCount: c._count.shipments,
    zoneCharges: c.zoneCharges
      .slice()
      .sort((a, b) => a.district.localeCompare(b.district))
      .map((z) => ({ district: z.district, charge: Number(z.charge) })),
  };
}

export type CourierOption = { id: number; name: string; codFeePercent: number };

// ---------- COD-pending list (SPEC §7 reconciliation screen) ----------

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CodPendingRow {
  shipmentId: number;
  orderId: number;
  orderNo: string;
  courier: string;
  recipientName: string;
  district: string;
  codAmount: number;
  feePercent: number;
  fee: number; // estimated courier COD fee
  dueAmount: number;
  deliveredAt: string | null;
  ageDays: number; // since delivery — aging for reconciliation
}

// Delivered shipments whose COD the courier still owes (SPEC §7). Aging uses the
// delivery date (Date.now lives here, not in the page component, per the purity rule).
export async function buildCodPending(): Promise<CodPendingRow[]> {
  const shipments = await prisma.shipment.findMany({
    where: { status: "DELIVERED", codReceived: false, codAmount: { gt: 0 } },
    orderBy: { deliveredAt: "asc" },
    include: {
      courier: { select: { name: true, codFeePercent: true } },
      order: {
        select: { id: true, orderNo: true, recipientName: true, district: true, dueAmount: true },
      },
    },
  });
  const now = Date.now();
  return shipments.map((s) => {
    const cod = Number(s.codAmount);
    const feePercent = Number(s.courier.codFeePercent);
    const since = s.deliveredAt ?? s.handoverDate;
    return {
      shipmentId: s.id,
      orderId: s.order.id,
      orderNo: s.order.orderNo,
      courier: s.courier.name,
      recipientName: s.order.recipientName,
      district: s.order.district,
      codAmount: cod,
      feePercent,
      fee: round2((cod * feePercent) / 100),
      dueAmount: Number(s.order.dueAmount),
      deliveredAt: s.deliveredAt ? s.deliveredAt.toISOString() : null,
      ageDays: Math.max(0, Math.floor((now - since.getTime()) / DAY_MS)),
    };
  });
}
