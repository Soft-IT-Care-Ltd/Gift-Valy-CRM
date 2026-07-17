// Steadfast integration verification (STEADFAST_INTEGRATION.md §6 acceptance).
// Three layers:
//   1. Pure unit tests   — status mapper (case-insensitive), phone normalize,
//                          webhook Bearer auth, encryption round-trip.
//   2. In-transaction    — full webhook/poll lifecycle against the SHARED
//                          shipment/order code path, rolled back so the DB is
//                          untouched (like scripts/verify-stock.ts): pending →
//                          delivered, idempotent replays, tracking timeline,
//                          cancelled → return flow, poll == webhook, and proof
//                          the MANUAL courier flow is unchanged.
//   3. Route-level       — the real POST /api/webhooks/steadfast handler:
//                          wrong/missing Bearer → 401 (nothing written),
//                          unknown consignment → 200 error. Cleans up after.
import { PrismaClient } from "@prisma/client";
import {
  mapSteadfastStatus,
  normalizeBdPhone,
  isFinalSteadfastStatus,
  realRider,
  findRiderInfo,
  findNumericField,
  DELIVERY_CHARGE_KEY,
  STEADFAST_COURIER_NAME,
} from "../lib/steadfast-constants";
import {
  displayedCourierStatus,
  isOvercharged,
} from "../lib/courier-constants";
import {
  encryptSecret,
  decryptSecret,
  generateToken,
} from "../lib/crypto";
import { verifyWebhookToken, bearerFromHeader } from "../lib/steadfast-integration";
import {
  ingestDeliveryStatus,
  ingestTrackingUpdate,
  shipmentForSyncInclude,
  type ShipmentForSync,
} from "../lib/steadfast-sync";
import { applyHandover, applyShipmentStatus } from "../lib/courier";

const prisma = new PrismaClient();
const ROLLBACK = "ROLLBACK_SENTINEL";

// Guarantee an encryption secret even if NEXTAUTH_SECRET isn't in the shell env.
try {
  encryptSecret("probe");
} catch {
  process.env.COURIER_ENCRYPTION_KEY = "verify-steadfast-fallback-key";
}

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

// ---------- 1. pure unit tests ----------

function unitTests() {
  console.log("status mapper — case-insensitive (§3B):");
  check('"Delivered" (capitalized) → DELIVERED', mapSteadfastStatus("Delivered").to === "DELIVERED");
  check('"delivered" → DELIVERED', mapSteadfastStatus("delivered").to === "DELIVERED");
  // §6m — approval-pending statuses stay IN_TRANSIT under a courier sub-state;
  // only the FINAL delivered/cancelled move the order.
  check(
    '"delivered_approval_pending" → stays IN_TRANSIT + sub-state (§6m)',
    mapSteadfastStatus("delivered_approval_pending").to === "IN_TRANSIT" &&
      mapSteadfastStatus("delivered_approval_pending").courierStatus === "DELIVERY_APPROVAL_PENDING"
  );
  check(
    '"cancelled_approval_pending" → stays IN_TRANSIT + sub-state (§6m)',
    mapSteadfastStatus("cancelled_approval_pending").to === "IN_TRANSIT" &&
      mapSteadfastStatus("cancelled_approval_pending").courierStatus === "RETURN_APPROVAL_PENDING"
  );
  check('"pending" → IN_TRANSIT', mapSteadfastStatus("pending").to === "IN_TRANSIT");
  check('"pending" → sub-state PENDING (§6m)', mapSteadfastStatus("pending").courierStatus === "PENDING");
  check('"hold" → IN_TRANSIT + onHold flag', mapSteadfastStatus("hold").to === "IN_TRANSIT" && mapSteadfastStatus("hold").onHold);
  check('"in_review" → no status move', mapSteadfastStatus("in_review").to === null);
  check('"cancelled" → RETURNED', mapSteadfastStatus("cancelled").to === "RETURNED");
  check('"CANCELLED" (upper) → RETURNED', mapSteadfastStatus("CANCELLED").to === "RETURNED");
  check('"partial_delivered" → no move, needs_attention', mapSteadfastStatus("partial_delivered").to === null && mapSteadfastStatus("partial_delivered").needsAttention);
  check('"unknown" → no move, needs_attention', mapSteadfastStatus("unknown").to === null && mapSteadfastStatus("unknown").needsAttention);
  check('undocumented status → unrecognized + needs_attention', !mapSteadfastStatus("zzz").recognized && mapSteadfastStatus("zzz").needsAttention);
  check("delivered is final (stop polling)", isFinalSteadfastStatus("Delivered"));
  check("pending is not final", !isFinalSteadfastStatus("pending"));
  // §6m — the shipment still awaits the hub manager: keep polling.
  check(
    "approval-pending is NOT final since C6 (keep polling)",
    !isFinalSteadfastStatus("delivered_approval_pending") &&
      !isFinalSteadfastStatus("cancelled_approval_pending")
  );

  console.log("\nphone normalization — 11-digit BD (§2, acceptance #4):");
  check('"+8801712345678" → 01712345678', normalizeBdPhone("+8801712345678") === "01712345678");
  check('"8801712345678" → 01712345678', normalizeBdPhone("8801712345678") === "01712345678");
  check('"01712345678" → 01712345678', normalizeBdPhone("01712345678") === "01712345678");
  check('spaces & dashes stripped', normalizeBdPhone("+880 1712-345 678") === "01712345678");
  check('10-digit "1712345678" → blocked (null)', normalizeBdPhone("1712345678") === null);
  check('foreign "+966512345678" → blocked (null)', normalizeBdPhone("+966512345678") === null);
  check('empty → null', normalizeBdPhone("") === null);

  // §R2 — a rider counts only with a name AND a contact; the display/filter
  // helper never lets an ASSIGNED-with-no-rider row read as Assigned.
  console.log("\n§R2 rider gating + Assigned display:");
  check("rider name + phone → real rider", realRider({ name: "Karim", phone: "01711111111" }) != null);
  check("rider name only (no contact) → NOT a real rider", realRider({ name: "Karim", phone: null }) === null);
  check("blank name → NOT a real rider", realRider({ name: "   ", phone: "01711111111" }) === null);
  check("null rider → null", realRider(null) === null);
  check(
    "a delivery_status payload (no rider) yields no rider",
    findRiderInfo({ notification_type: "delivery_status", consignment_id: 1, status: "pending", delivery_charge: 60 }) === null
  );
  check(
    "flat rider_name + rider_phone in a payload → real rider",
    realRider(findRiderInfo({ rider_name: "Rahim", rider_phone: "01822222222" })) != null
  );
  check("ASSIGNED + rider → shows Assigned", displayedCourierStatus("ASSIGNED", true) === "ASSIGNED");
  check("ASSIGNED + NO rider → shows Pending (§R2)", displayedCourierStatus("ASSIGNED", false) === "PENDING");
  check("null sub-state → shows Pending", displayedCourierStatus(null, false) === "PENDING");
  check("approval sub-state unaffected by rider", displayedCourierStatus("DELIVERY_APPROVAL_PENDING", false) === "DELIVERY_APPROVAL_PENDING");

  // §R3 — the charge is mined from any payload under any of its spellings.
  console.log("\n§R3 delivery-charge capture from varied payload keys:");
  check("delivery_charge key", findNumericField({ delivery_charge: 70 }, DELIVERY_CHARGE_KEY) === 70);
  check("total_delivery_charge key", findNumericField({ result: { total_delivery_charge: 90 } }, DELIVERY_CHARGE_KEY) === 90);
  check("delivery_fee key", findNumericField({ delivery_fee: 55 }, DELIVERY_CHARGE_KEY) === 55);
  check("case-insensitive DeliveryCharge", findNumericField({ DeliveryCharge: 65 }, DELIVERY_CHARGE_KEY) === 65);
  check("cod_charge is NOT matched as delivery charge", findNumericField({ cod_charge: 20 }, DELIVERY_CHARGE_KEY) === null);

  // §R4 — overcharge alert fires only past the tolerance.
  console.log("\n§R4 overcharge tolerance:");
  check("SF 10% over, tol 10% → not flagged (within)", isOvercharged(100, 110, 10) === false);
  check("SF >10% over, tol 10% → flagged", isOvercharged(100, 110.01, 10) === true);
  check("SF below ours → never flagged", isOvercharged(100, 80, 10) === false);
  check("no baseline (ours null) → never flagged", isOvercharged(null, 500, 10) === false);
  check("weight 2.5 vs 2.9 kg, tol 10% → flagged (16% over)", isOvercharged(2.5, 2.9, 10) === true);

  console.log("\nwebhook Bearer auth (§3A, acceptance #5):");
  const token = generateToken(32);
  check("token is 32+ chars", token.length >= 32);
  const integ = { webhookTokenEncrypted: encryptSecret(token) } as never;
  check("correct token verifies", verifyWebhookToken(integ, token) === true);
  check("wrong token rejected", verifyWebhookToken(integ, token + "x") === false);
  check("missing token rejected", verifyWebhookToken(integ, null) === false);
  check("no-integration rejected", verifyWebhookToken(null, token) === false);
  check('bearer header parsed', bearerFromHeader(`Bearer ${token}`) === token);
  check('non-bearer header → null', bearerFromHeader("Basic abc") === null);
  check("encrypt → decrypt round-trip", decryptSecret(encryptSecret("s3cr3t")) === "s3cr3t");
}

// ---------- 2. in-transaction lifecycle (rolled back) ----------

async function integrationTests() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { name: "Admin" } } });
  const customer = await prisma.customer.findFirstOrThrow();

  try {
    await prisma.$transaction(
      async (tx) => {
        const steadfast = await tx.courier.upsert({
          where: { name: STEADFAST_COURIER_NAME },
          update: {},
          create: { name: STEADFAST_COURIER_NAME, isActive: true },
        });
        const pathao = await tx.courier.upsert({
          where: { name: "Pathao" },
          update: {},
          create: { name: "Pathao", isActive: true },
        });

        const load = (id: number) =>
          tx.shipment.findUniqueOrThrow({ where: { id }, include: shipmentForSyncInclude });
        const asSync = (s: Awaited<ReturnType<typeof load>>) =>
          s as unknown as ShipmentForSync;
        const orderStatus = (id: number) =>
          tx.order.findUniqueOrThrow({ where: { id }, select: { status: true } }).then((o) => o.status);

        async function makePackedOrder(orderNo: string, cod: number) {
          return tx.order.create({
            data: {
              orderNo,
              customerId: customer.id,
              recipientName: "Verify Recipient",
              recipientPhoneBd: "01712345678",
              deliveryAddress: "House 1, Road 2",
              district: "Dhaka",
              thana: "Dhanmondi",
              subtotal: cod, totalAmount: cod, dueAmount: cod, codAmount: cod,
              status: "PACKED",
              salesExecutiveId: admin.id,
            },
          });
        }
        async function sendViaSteadfast(orderId: number, cid: number, cod: number) {
          const ship = await applyHandover(
            tx,
            { orderId, courierId: steadfast.id, trackingNo: `TRK${cid}`, handoverDate: new Date(), codAmount: cod, expectedDelivery: null, note: `Sent via Steadfast API, tracking TRK${cid}` },
            admin.id
          );
          await tx.shipment.update({
            where: { id: ship.id },
            data: { consignmentId: BigInt(cid), steadfastStatus: "in_review" },
          });
          return ship;
        }

        // ---- A. send → handover reuses the existing shipment logic (§2) ----
        console.log("\nA. Send to Steadfast → shipment via existing applyHandover:");
        const o1 = await makePackedOrder("GV-SFTEST-0001", 1500);
        const ship1 = await sendViaSteadfast(o1.id, 1000001, 1500);
        check("order flipped PACKED → HANDED_TO_COURIER", (await orderStatus(o1.id)) === "HANDED_TO_COURIER");
        check("shipment carries the Steadfast consignment id", Number((await load(ship1.id)).consignmentId) === 1000001);
        check("handover wrote an order_status_history row", (await tx.orderStatusHistory.count({ where: { orderId: o1.id, toStatus: "HANDED_TO_COURIER" } })) === 1);

        // ---- B. webhook pending → IN_TRANSIT (§3A / acceptance #6) ----
        console.log("\nB. Webhook delivery_status through the shared status path:");
        await ingestDeliveryStatus(tx, {
          shipment: asSync(await load(ship1.id)),
          rawStatus: "pending",
          source: "WEBHOOK",
          rawPayload: { notification_type: "delivery_status", consignment_id: 1000001, status: "pending" },
        });
        check("webhook 'pending' → order IN_TRANSIT", (await orderStatus(o1.id)) === "IN_TRANSIT");
        check("webhook 'pending' → shipment IN_TRANSIT", (await load(ship1.id)).status === "IN_TRANSIT");

        // "Delivered" (capitalized) + delivery_charge (acceptance #6)
        await ingestDeliveryStatus(tx, {
          shipment: asSync(await load(ship1.id)),
          rawStatus: "Delivered",
          source: "WEBHOOK",
          rawPayload: { notification_type: "delivery_status", consignment_id: 1000001, status: "Delivered", delivery_charge: 120 },
          deliveryCharge: 120,
        });
        const s1 = await load(ship1.id);
        check("webhook 'Delivered' → order DELIVERED", (await orderStatus(o1.id)) === "DELIVERED");
        check("delivery_charge → courier_cost_actual (real cost, P&L)", Number(s1.courierCostActual) === 120);
        check(
          "COD in reconciliation queue (delivered, cod>0, not received)",
          s1.status === "DELIVERED" && Number(s1.codAmount) > 0 && s1.codReceived === false
        );

        // ---- B2. §R2 rider→ASSIGNED gating + §R3 charge capture, end-to-end ----
        console.log("\nB2. §R2 warehouse-received stays Pending until a real rider; §R3 charge:");
        const oR2 = await makePackedOrder("GV-SFTEST-R2", 800);
        const shipR2 = await sendViaSteadfast(oR2.id, 1000090, 800);
        // Warehouse receive (pending) with NO rider → Pending, never Assigned.
        await ingestDeliveryStatus(tx, {
          shipment: asSync(await load(shipR2.id)),
          rawStatus: "pending",
          source: "POLL",
          rawPayload: { consignment_id: 1000090, delivery_status: "pending" },
        });
        let sR2 = await load(shipR2.id);
        check("§R2 pending, no rider → courierStatus PENDING", sR2.courierStatus === "PENDING");
        check("§R2 pending, no rider → riderName stays null", sR2.riderName === null);

        // A payload with a rider NAME but no contact must NOT flip Assigned.
        await ingestDeliveryStatus(tx, {
          shipment: asSync(await load(shipR2.id)),
          rawStatus: "pending",
          source: "POLL",
          rawPayload: { consignment_id: 1000090, delivery_status: "pending", rider: { name: "Placeholder Hub" } },
        });
        sR2 = await load(shipR2.id);
        check("§R2 rider name only (no contact) → still PENDING", sR2.courierStatus === "PENDING");
        check("§R2 rider name only → riderName not stored", sR2.riderName === null);

        // A real rider (name + phone) in the payload → ASSIGNED with rider stored,
        // and §R3 mines the charge from an undocumented `total_delivery_charge`.
        await ingestDeliveryStatus(tx, {
          shipment: asSync(await load(shipR2.id)),
          rawStatus: "pending",
          source: "POLL",
          rawPayload: {
            consignment_id: 1000090,
            delivery_status: "pending",
            rider: { name: "Karim Rider", phone: "01711111111" },
            total_delivery_charge: 95,
          },
        });
        sR2 = await load(shipR2.id);
        check("§R2 real rider (name+phone) → ASSIGNED", sR2.courierStatus === "ASSIGNED");
        check("§R2 real rider → riderName + riderPhone stored", sR2.riderName === "Karim Rider" && sR2.riderPhone === "01711111111");
        check("§R3 charge mined from total_delivery_charge → courier_cost_actual", Number(sR2.courierCostActual) === 95);

        // A later pending with NO rider must NOT downgrade a genuine ASSIGNED.
        await ingestDeliveryStatus(tx, {
          shipment: asSync(await load(shipR2.id)),
          rawStatus: "pending",
          source: "POLL",
          rawPayload: { consignment_id: 1000090, delivery_status: "pending" },
        });
        sR2 = await load(shipR2.id);
        check("§R2 later pending (no rider) → ASSIGNED not downgraded", sR2.courierStatus === "ASSIGNED");
        check("§R2 rider on record is kept", sR2.riderName === "Karim Rider");

        // ---- C. idempotency: replayed webhook (§3A step 5 / acceptance #7) ----
        console.log("\nC. Duplicate webhook is idempotent:");
        const histBefore = await tx.orderStatusHistory.count({ where: { orderId: o1.id } });
        const logsBefore = await tx.shipmentStatusLog.count({ where: { shipmentId: ship1.id } });
        await ingestDeliveryStatus(tx, {
          shipment: asSync(await load(ship1.id)),
          rawStatus: "Delivered",
          source: "WEBHOOK",
          rawPayload: { notification_type: "delivery_status", consignment_id: 1000001, status: "Delivered", delivery_charge: 120 },
          deliveryCharge: 120,
        });
        check("replay → NO duplicate order_status_history", (await tx.orderStatusHistory.count({ where: { orderId: o1.id } })) === histBefore);
        check("replay → raw payload still logged (audit trail)", (await tx.shipmentStatusLog.count({ where: { shipmentId: ship1.id } })) === logsBefore + 1);

        // ---- D. tracking_update → timeline only (§3A payload 2 / acceptance #8) ----
        console.log("\nD. tracking_update → timeline, status unchanged:");
        const statusPreTrack = await orderStatus(o1.id);
        await ingestTrackingUpdate(tx, { shipmentId: ship1.id, message: "Rider assigned", eventAt: new Date(), source: "WEBHOOK" });
        check("tracking event appended to timeline", (await tx.shipmentTrackingEvent.count({ where: { shipmentId: ship1.id } })) === 1);
        check("order status unchanged by tracking_update", (await orderStatus(o1.id)) === statusPreTrack);

        // ---- E. cancelled → RETURNED, return flow gated, idempotent (acceptance #7) ----
        console.log("\nE. Webhook cancelled → return flow (Admin-gated), idempotent:");
        const o2 = await makePackedOrder("GV-SFTEST-0002", 800);
        const ship2 = await sendViaSteadfast(o2.id, 1000002, 800);
        await ingestDeliveryStatus(tx, {
          shipment: asSync(await load(ship2.id)),
          rawStatus: "cancelled",
          source: "WEBHOOK",
          rawPayload: { notification_type: "delivery_status", consignment_id: 1000002, status: "cancelled" },
        });
        check("webhook 'cancelled' → order RETURNED", (await orderStatus(o2.id)) === "RETURNED");
        check("stock restore waits for the receive inspection (§6n)", (await load(ship2.id)).returnApproved === false);
        const hist2 = await tx.orderStatusHistory.count({ where: { orderId: o2.id } });
        await ingestDeliveryStatus(tx, {
          shipment: asSync(await load(ship2.id)),
          rawStatus: "cancelled",
          source: "WEBHOOK",
          rawPayload: { notification_type: "delivery_status", consignment_id: 1000002, status: "cancelled" },
        });
        check("replay 'cancelled' → no duplicate history / no re-trigger", (await tx.orderStatusHistory.count({ where: { orderId: o2.id } })) === hist2);

        // ---- F. poll path == webhook path (§3B / acceptance #9) ----
        console.log("\nF. Poll fallback produces the same result as the webhook:");
        const o3 = await makePackedOrder("GV-SFTEST-0003", 500);
        const ship3 = await sendViaSteadfast(o3.id, 1000003, 500);
        await ingestDeliveryStatus(tx, {
          shipment: asSync(await load(ship3.id)),
          rawStatus: "pending",
          source: "POLL",
          rawPayload: { consignment_id: 1000003, delivery_status: "pending" },
        });
        check("poll 'pending' → IN_TRANSIT (same as webhook)", (await orderStatus(o3.id)) === "IN_TRANSIT");
        check("poll stamps last_polled_at", (await load(ship3.id)).lastPolledAt !== null);
        await ingestDeliveryStatus(tx, {
          shipment: asSync(await load(ship3.id)),
          rawStatus: "delivered",
          source: "POLL",
          rawPayload: { consignment_id: 1000003, delivery_status: "delivered" },
        });
        check("poll 'delivered' → DELIVERED (same as webhook)", (await orderStatus(o3.id)) === "DELIVERED");

        // ---- G. MANUAL courier flow (Pathao) unchanged — requirement #6 ----
        console.log("\nG. Manual courier flow (non-Steadfast) is 100% unchanged:");
        const o4 = await makePackedOrder("GV-SFTEST-0004", 0);
        const ship4 = await applyHandover(
          tx,
          { orderId: o4.id, courierId: pathao.id, trackingNo: "PT-1", handoverDate: new Date(), codAmount: 0, expectedDelivery: null, note: null },
          admin.id
        );
        check("manual handover → HANDED_TO_COURIER", (await orderStatus(o4.id)) === "HANDED_TO_COURIER");
        await applyShipmentStatus(tx, ship4.id, { to: "IN_TRANSIT", note: null }, admin.id);
        check("manual → IN_TRANSIT works", (await orderStatus(o4.id)) === "IN_TRANSIT");
        await applyShipmentStatus(tx, ship4.id, { to: "DELIVERED", note: null, courierCostActual: 60 }, admin.id);
        const s4 = await tx.shipment.findUniqueOrThrow({ where: { id: ship4.id } });
        check("manual → DELIVERED works", (await orderStatus(o4.id)) === "DELIVERED");
        check("manual shipment has NO Steadfast fields set", s4.consignmentId === null && s4.steadfastStatus === null);
        check("manual shipment produced NO Steadfast status logs", (await tx.shipmentStatusLog.count({ where: { shipmentId: ship4.id } })) === 0);

        throw new Error(ROLLBACK);
      },
      { timeout: 30000 }
    );
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
    console.log("\n(transaction rolled back — DB unchanged)\n");
  }
}

// ---------- 3. real webhook route (auth), cleaned up ----------

async function routeTests() {
  console.log("Route POST /api/webhooks/steadfast (acceptance #5):");
  let POST: (req: Request) => Promise<Response>;
  try {
    ({ POST } = await import("../app/api/webhooks/steadfast/route"));
  } catch (e) {
    console.log(`  … skipped (route not importable under tsx: ${e instanceof Error ? e.message : e})`);
    return;
  }

  const before = await prisma.courierIntegration.findUnique({ where: { courier: "STEADFAST" } });
  const testToken = generateToken(32);
  await prisma.courierIntegration.upsert({
    where: { courier: "STEADFAST" },
    create: { courier: "STEADFAST", webhookTokenEncrypted: encryptSecret(testToken) },
    update: { webhookTokenEncrypted: encryptSecret(testToken) },
  });
  const maxLog = (await prisma.shipmentStatusLog.aggregate({ _max: { id: true } }))._max.id ?? 0;

  const req = (headers: Record<string, string>, body: unknown) =>
    new Request("http://localhost/api/webhooks/steadfast", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const payload = { notification_type: "delivery_status", consignment_id: 1, status: "Delivered" };

  const wrong = await POST(req({ Authorization: "Bearer WRONG-TOKEN" }, payload));
  check("wrong Bearer token → 401", wrong.status === 401);

  const missing = await POST(req({}, payload));
  check("missing Bearer token → 401", missing.status === 401);

  const unmatched = await POST(
    req(
      { Authorization: `Bearer ${testToken}` },
      { notification_type: "delivery_status", consignment_id: 999999999, invoice: "GV-NOPE-9999", status: "Delivered" }
    )
  );
  const body = (await unmatched.json()) as { status?: string };
  check("correct token, unknown consignment → 200", unmatched.status === 200);
  check("unknown consignment → error body (logged, no crash)", body.status === "error");

  // cleanup — remove the unmatched log rows and restore the integration token.
  await prisma.shipmentStatusLog.deleteMany({ where: { id: { gt: maxLog }, shipmentId: null } });
  if (!before) {
    await prisma.courierIntegration.delete({ where: { courier: "STEADFAST" } });
  } else {
    await prisma.courierIntegration.update({
      where: { courier: "STEADFAST" },
      data: {
        webhookTokenEncrypted: before.webhookTokenEncrypted,
        lastWebhookAt: before.lastWebhookAt,
      },
    });
  }
  console.log("  (integration row restored — DB unchanged)");
}

async function main() {
  console.log("Steadfast integration verification\n");
  unitTests();
  console.log("");
  await integrationTests();
  await routeTests();
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
