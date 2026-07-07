import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { applyShipmentStatus } from "./courier";
import { getSystemUserId } from "./system-user";
import { ALLOWED_TRANSITIONS } from "./order-constants";
import {
  mapSteadfastStatus,
  STEADFAST_COURIER_NAME,
  type MappedSteadfastStatus,
} from "./steadfast-constants";
import { requireEnabledSteadfast } from "./steadfast-integration";
import { statusByCid, statusByInvoice } from "./steadfast";

// ============ Steadfast status sync (STEADFAST_INTEGRATION.md §3) ============
//
// The single place a Steadfast delivery status becomes a Gift Valy status change.
// Both the webhook (§3A, source=WEBHOOK) and the poller (§3B, source=POLL) call
// ingestDeliveryStatus, which routes ANY status transition through the SAME
// applyShipmentStatus used by manual courier updates — so order_status_history,
// the stock/return hooks and COD reconciliation fire identically to a hand entry.
//
// Idempotency (§3A step 5): every raw payload is logged, but a transition only
// happens when the target differs from the shipment's current status AND is a
// legal order transition. A duplicate/replayed webhook therefore adds no history
// row and never re-triggers the return flow.

export type Source = "WEBHOOK" | "POLL";

// The shape ingestDeliveryStatus needs — load the shipment with its order.
export interface ShipmentForSync {
  id: number;
  status: "HANDED_TO_COURIER" | "IN_TRANSIT" | "DELIVERED" | "RETURNED";
  order: { id: number; status: string; cancelReason: string | null };
}

export const shipmentForSyncInclude = {
  order: { select: { id: true, status: true, cancelReason: true } },
} satisfies Prisma.ShipmentInclude;

export interface IngestResult {
  matched: true;
  mapped: MappedSteadfastStatus;
  transitioned: boolean; // did the order/shipment status actually change
  to: string | null;
}

// Log-only helper for a payload whose consignment we don't recognize (§3A step 1).
export async function logUnmatchedStatus(
  tx: Prisma.TransactionClient,
  rawPayload: unknown,
  rawStatus: string | null,
  source: Source
) {
  await tx.shipmentStatusLog.create({
    data: {
      shipmentId: null,
      rawPayload: (rawPayload ?? {}) as Prisma.InputJsonValue,
      rawStatus,
      source,
    },
  });
}

export async function ingestDeliveryStatus(
  tx: Prisma.TransactionClient,
  args: {
    shipment: ShipmentForSync;
    rawStatus: string;
    source: Source;
    rawPayload: unknown;
    deliveryCharge?: number | null;
  }
): Promise<IngestResult> {
  const { shipment, rawStatus, source, rawPayload } = args;
  const systemUserId = await getSystemUserId(tx);

  // 1. Audit trail — every received status, always (§3A step 4 / §3B step 4).
  await tx.shipmentStatusLog.create({
    data: {
      shipmentId: shipment.id,
      rawPayload: (rawPayload ?? {}) as Prisma.InputJsonValue,
      rawStatus,
      source,
    },
  });

  // 2. Map (case-insensitive) and decide whether a status move is warranted.
  const mapped = mapSteadfastStatus(rawStatus);
  const target = mapped.to;
  const orderStatus = shipment.order.status as keyof typeof ALLOWED_TRANSITIONS;

  let transitioned = false;
  let flagUnexpected = false;
  if (target) {
    if (shipment.status === target) {
      // Already there — idempotent no-op (no duplicate history, no re-trigger).
    } else if (ALLOWED_TRANSITIONS[orderStatus]?.includes(target)) {
      await applyShipmentStatus(
        tx,
        shipment.id,
        {
          to: target,
          note: `Steadfast ${source.toLowerCase()}: ${rawStatus}`,
        },
        systemUserId
      );
      transitioned = true;
    } else {
      // A status we understand but that can't legally apply from here (e.g. a
      // late "pending" after DELIVERED) — surface for a human, never throw.
      flagUnexpected = true;
    }
  }

  // 3. Steadfast-specific fields + operator flags. applyShipmentStatus already
  // set status/delivered_at above; here we set the raw status, flags, poll stamp
  // and the real courier cost from the webhook's delivery_charge (§3A step 3).
  const data: Prisma.ShipmentUpdateInput = {
    steadfastStatus: mapped.normalized,
    onHold: mapped.onHold,
    needsAttention: mapped.needsAttention || flagUnexpected,
    updatedBy: systemUserId,
  };
  if (source === "POLL") data.lastPolledAt = new Date();
  if (args.deliveryCharge != null) {
    data.courierCostActual = Math.round(args.deliveryCharge * 100) / 100;
  }
  await tx.shipment.update({ where: { id: shipment.id }, data });

  return { matched: true, mapped, transitioned, to: target };
}

// Tracking-only update (§3A payload 2) — no status change, just a timeline entry.
export async function ingestTrackingUpdate(
  tx: Prisma.TransactionClient,
  args: {
    shipmentId: number;
    message: string;
    eventAt: Date;
    source: Source;
  }
) {
  await tx.shipmentTrackingEvent.create({
    data: {
      shipmentId: args.shipmentId,
      message: args.message,
      eventAt: args.eventAt,
      source: args.source,
    },
  });
}

// ---------- polling fallback (§3B) + manual "Sync now" ----------

export interface PollSummary {
  polled: number;
  changed: number;
  errors: { shipmentId: number; error: string }[];
}

// Reconcile non-final Steadfast shipments via the status API. Runs one network
// call per shipment OUTSIDE any transaction, then a small per-shipment
// transaction for the DB writes — so a single failure never rolls back the rest
// and no transaction is held open across the network (§5). Pass a shipmentId for
// the per-shipment refresh icon (ignores the interval); omit for the batch job.
export async function runSteadfastPoll(opts?: {
  shipmentId?: number;
}): Promise<PollSummary> {
  const { integration, creds } = await requireEnabledSteadfast();
  const summary: PollSummary = { polled: 0, changed: 0, errors: [] };

  const courier = await prisma.courier.findUnique({
    where: { name: STEADFAST_COURIER_NAME },
    select: { id: true },
  });
  if (!courier) return summary;

  const intervalMs = Math.max(1, integration.pollingMinutes) * 60_000;
  const cutoff = new Date(Date.now() - intervalMs);

  const shipments = await prisma.shipment.findMany({
    where: {
      courierId: courier.id,
      consignmentId: { not: null },
      // Only non-final states (§3B step: stop once DELIVERED/RETURNED/PARTIAL).
      order: { status: { in: ["HANDED_TO_COURIER", "IN_TRANSIT"] } },
      ...(opts?.shipmentId
        ? { id: opts.shipmentId }
        : { OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: cutoff } }] }),
    },
    select: {
      id: true,
      consignmentId: true,
      order: { select: { orderNo: true } },
    },
  });

  for (const s of shipments) {
    summary.polled += 1;
    try {
      let raw: string | null = null;
      try {
        raw = await statusByCid(creds, s.consignmentId!);
      } catch {
        // Fallback to invoice lookup per §3B step 2.
        raw = await statusByInvoice(creds, s.order.orderNo);
      }
      if (!raw) continue;

      const changed = await prisma.$transaction(async (tx) => {
        const shipment = await tx.shipment.findUnique({
          where: { id: s.id },
          include: shipmentForSyncInclude,
        });
        if (!shipment) return false;
        const res = await ingestDeliveryStatus(tx, {
          shipment: shipment as unknown as ShipmentForSync,
          rawStatus: raw!,
          source: "POLL",
          rawPayload: { consignment_id: Number(s.consignmentId), delivery_status: raw },
        });
        return res.transitioned;
      });
      if (changed) summary.changed += 1;

      // Rate-limit friendly: a small gap between calls (§5).
      await new Promise((r) => setTimeout(r, 150));
    } catch (e) {
      summary.errors.push({
        shipmentId: s.id,
        error: e instanceof Error ? e.message : "poll failed",
      });
    }
  }

  await prisma.courierIntegration.update({
    where: { id: integration.id },
    data: { lastSyncAt: new Date() },
  });

  return summary;
}
