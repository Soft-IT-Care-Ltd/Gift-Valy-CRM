// Verification for CORRECTIONS C5 — Courier §1/§2 + Orders §6j/§6k/§6l:
// zone+weight cost estimation, auto-PACK on handover from CONFIRMED, webhook
// charge/weight capture, tracking-link discovery. Mutating checks run inside a
// transaction that is ALWAYS rolled back — the DB is left untouched.
//
// Run: npm run verify:courier-cost

import { prisma } from "../lib/db";
import {
  applyHandover,
  courierZoneRate,
  orderWeightKg,
} from "../lib/courier";
import { estimateCourierCost } from "../lib/courier-constants";
import { ingestDeliveryStatus, type ShipmentForSync, shipmentForSyncInclude } from "../lib/steadfast-sync";
import {
  discoverTrackingUrl,
  findNumericField,
  trackingUrlFromCode,
  DELIVERY_CHARGE_KEY,
  WEIGHT_KEY,
  STEADFAST_COURIER_NAME,
} from "../lib/steadfast-constants";

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

async function main() {
  console.log("A. Pure helpers (tracking link + field discovery):");
  check(
    "trackingUrlFromCode builds the /tl/ link",
    trackingUrlFromCode("15BAJKB8") === "https://steadfast.com.bd/tl/15BAJKB8"
  );
  check("trackingUrlFromCode(null) → null", trackingUrlFromCode(null) === null);
  check(
    "discoverTrackingUrl finds a *tracking_link* key",
    discoverTrackingUrl({
      consignment: { tracking_code: "X", public_tracking_link: "abc123" },
    }) === "https://steadfast.com.bd/tl/abc123"
  );
  check(
    "discoverTrackingUrl finds an embedded /tl/ URL",
    discoverTrackingUrl({
      consignment: { note: "see https://steadfast.com.bd/tl/tok9 for status" },
    }) === "https://steadfast.com.bd/tl/tok9"
  );
  check(
    "discoverTrackingUrl → null when nothing matches (documented response)",
    discoverTrackingUrl({ consignment: { consignment_id: 1, tracking_code: "AB" } }) === null
  );
  check(
    "findNumericField digs out delivery_charge",
    findNumericField({ a: { delivery_charge: "80.5" } }, DELIVERY_CHARGE_KEY) === 80.5
  );
  check(
    "findNumericField digs out weight",
    findNumericField({ consignment: { weight: 4.9 } }, WEIGHT_KEY) === 4.9
  );
  check(
    "estimateCourierCost = base + perKg × weight",
    estimateCourierCost({ baseRate: 60, perKgRate: 15 }, 1.05) === 75.75
  );
  check("estimateCourierCost without a rate → null", estimateCourierCost(null, 2) === null);

  console.log("\nB. Handover from CONFIRMED auto-packs + estimates (rolled back):");
  const courier = await prisma.courier.findUnique({
    where: { name: STEADFAST_COURIER_NAME },
    select: { id: true },
  });
  if (!courier) throw new Error("Steadfast courier row missing — seed first");

  const order = await prisma.order.findFirst({
    where: { status: "CONFIRMED", shipment: { is: null } },
    orderBy: { id: "asc" },
    select: { id: true, orderNo: true },
  });
  if (!order) throw new Error("No CONFIRMED order without a shipment to test with");

  try {
    await prisma.$transaction(async (tx) => {
      const weight = await orderWeightKg(tx, order.id);
      const rate = await courierZoneRate(tx, courier.id, "INSIDE_DHAKA");
      check("zone rate configured for Inside Dhaka", rate !== null);

      const shipment = await applyHandover(
        tx,
        {
          orderId: order.id,
          courierId: courier.id,
          trackingNo: null,
          handoverDate: new Date("2026-07-17T00:00:00Z"),
          codAmount: 0,
          expectedDelivery: null,
          note: "verify-courier-cost",
          deliveryZone: "INSIDE_DHAKA",
          weightKg: weight,
        },
        1
      );

      const after = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        select: {
          status: true,
          items: { select: { unitCostSnapshot: true } },
          statusHistory: { select: { fromStatus: true, toStatus: true }, orderBy: { id: "asc" } },
        },
      });
      check(
        "order ended HANDED_TO_COURIER",
        after.status === "HANDED_TO_COURIER",
        after.status
      );
      const hops = after.statusHistory.map((h) => `${h.fromStatus}→${h.toStatus}`);
      check(
        "history shows the implicit CONFIRMED→PACKED hop (§6j)",
        hops.includes("CONFIRMED→PACKED"),
        hops.join(", ")
      );
      check(
        "history shows PACKED→HANDED_TO_COURIER",
        hops.includes("PACKED→HANDED_TO_COURIER")
      );
      check(
        "cost snapshots froze at the auto-pack",
        after.items.every((it) => it.unitCostSnapshot !== null)
      );

      const s = await tx.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      check("shipment stored the zone", s.deliveryZone === "INSIDE_DHAKA");
      check(
        "shipment stored the weight",
        weight === null || Number(s.weightKg) === weight,
        `${s.weightKg} vs ${weight}`
      );
      const expectedEst = estimateCourierCost(rate, weight);
      check(
        "shipment stored the zone+weight estimate (§1)",
        (expectedEst === null && s.courierCostEstimated === null) ||
          Number(s.courierCostEstimated) === expectedEst,
        `${s.courierCostEstimated} vs ${expectedEst}`
      );

      // C. Webhook charge/weight capture overrides (§6l) — same transaction.
      console.log("\nC. Webhook delivery_charge + weight capture (§6l):");
      const forSync = await tx.shipment.findUniqueOrThrow({
        where: { id: shipment.id },
        include: shipmentForSyncInclude,
      });
      await ingestDeliveryStatus(tx, {
        shipment: forSync as unknown as ShipmentForSync,
        rawStatus: "pending",
        source: "WEBHOOK",
        rawPayload: {
          consignment_id: 999999,
          notification_type: "delivery_status",
          status: "pending",
          delivery_charge: 80.5,
          weight: 1.2,
        },
      });
      const synced = await tx.shipment.findUniqueOrThrow({ where: { id: shipment.id } });
      check(
        "webhook delivery_charge → courier_cost_actual (overrides estimate)",
        Number(synced.courierCostActual) === 80.5,
        String(synced.courierCostActual)
      );
      check(
        "webhook weight → steadfast_weight_kg",
        Number(synced.steadfastWeightKg) === 1.2,
        String(synced.steadfastWeightKg)
      );
      const syncedOrder = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        select: { status: true },
      });
      check("'pending' moved the order to IN_TRANSIT", syncedOrder.status === "IN_TRANSIT");

      throw new Rollback();
      // Remote dev DB (Neon) + BOM loads outrun the 5s default — give the
      // rollback transaction room to finish all checks.
    }, { timeout: 60_000, maxWait: 15_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  console.log("\n(transaction rolled back — DB unchanged)");

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
