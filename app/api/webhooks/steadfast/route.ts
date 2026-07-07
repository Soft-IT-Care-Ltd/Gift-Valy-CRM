import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  getSteadfastIntegration,
  verifyWebhookToken,
  bearerFromHeader,
} from "@/lib/steadfast-integration";
import {
  ingestDeliveryStatus,
  ingestTrackingUpdate,
  logUnmatchedStatus,
  shipmentForSyncInclude,
  type ShipmentForSync,
} from "@/lib/steadfast-sync";

// Inbound webhook receiver (STEADFAST_INTEGRATION.md §3A). Bearer-authenticated;
// primary real-time status/tracking source. Status changes route through the
// SAME status-update code path as manual updates (ingestDeliveryStatus →
// applyShipmentStatus), so COD reconciliation and the return flow trigger
// identically. Idempotent, and it never crashes the app (§5).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OK = { status: "success", message: "Webhook received successfully." };

// Resolve the shipment by Steadfast consignment_id, falling back to invoice =
// order_no (§3A step 1).
async function findShipment(
  consignmentId: unknown,
  invoice: unknown
): Promise<(ShipmentForSync & Record<string, unknown>) | null> {
  const cid =
    consignmentId != null && !Number.isNaN(Number(consignmentId))
      ? BigInt(Number(consignmentId))
      : null;
  if (cid != null) {
    const s = await prisma.shipment.findUnique({
      where: { consignmentId: cid },
      include: shipmentForSyncInclude,
    });
    if (s) return s as unknown as ShipmentForSync & Record<string, unknown>;
  }
  if (typeof invoice === "string" && invoice.trim()) {
    const s = await prisma.shipment.findFirst({
      where: { order: { orderNo: invoice.trim() } },
      include: shipmentForSyncInclude,
    });
    if (s) return s as unknown as ShipmentForSync & Record<string, unknown>;
  }
  return null;
}

export async function POST(req: Request) {
  // 1. AUTH FIRST — a bad/missing Bearer returns 401 before any DB write
  //    (acceptance #5: wrong/missing token → 401, nothing changes).
  const integration = await getSteadfastIntegration();
  const presented = bearerFromHeader(req.headers.get("authorization"));
  if (!verifyWebhookToken(integration, presented)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse body (malformed JSON → 400, still no side effects).
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    // Health signal: a webhook was received and authenticated (§3A settings).
    await prisma.courierIntegration.update({
      where: { id: integration!.id },
      data: { lastWebhookAt: new Date() },
    });

    const notificationType = String(payload.notification_type ?? "");

    if (notificationType === "delivery_status") {
      const shipment = await findShipment(payload.consignment_id, payload.invoice);
      if (!shipment) {
        await logUnmatchedStatus(
          prisma as unknown as Prisma.TransactionClient,
          payload,
          payload.status != null ? String(payload.status) : null,
          "WEBHOOK"
        );
        return NextResponse.json(
          { status: "error", message: "Invalid consignment ID." },
          { status: 200 }
        );
      }
      const deliveryCharge =
        payload.delivery_charge != null && !Number.isNaN(Number(payload.delivery_charge))
          ? Number(payload.delivery_charge)
          : null;
      await prisma.$transaction((tx) =>
        ingestDeliveryStatus(tx, {
          shipment,
          rawStatus: String(payload.status ?? ""),
          source: "WEBHOOK",
          rawPayload: payload,
          deliveryCharge,
        })
      );
      return NextResponse.json(OK, { status: 200 });
    }

    if (notificationType === "tracking_update") {
      const shipment = await findShipment(payload.consignment_id, payload.invoice);
      if (!shipment) {
        await logUnmatchedStatus(
          prisma as unknown as Prisma.TransactionClient,
          payload,
          null,
          "WEBHOOK"
        );
        return NextResponse.json(OK, { status: 200 });
      }
      const rawAt = payload.updated_at ? new Date(String(payload.updated_at)) : new Date();
      const eventAt = Number.isNaN(rawAt.getTime()) ? new Date() : rawAt;
      await prisma.$transaction((tx) =>
        ingestTrackingUpdate(tx, {
          shipmentId: shipment.id,
          message: String(payload.tracking_message ?? "").slice(0, 1000),
          eventAt,
          source: "WEBHOOK",
        })
      );
      return NextResponse.json(OK, { status: 200 });
    }

    // Unknown notification_type → log, respond 200 (never crash, §3A).
    await logUnmatchedStatus(
      prisma as unknown as Prisma.TransactionClient,
      payload,
      null,
      "WEBHOOK"
    );
    return NextResponse.json(OK, { status: 200 });
  } catch (e) {
    // Unexpected server error — log and 500 so Steadfast retries (safe: idempotent).
    console.error("Steadfast webhook processing error:", e);
    return NextResponse.json(
      { status: "error", message: "Processing error" },
      { status: 500 }
    );
  }
}
