// One-off data repair for CORRECTIONS Round 2 (§2.4 / §2.5) — run ONCE on the
// production DB right after deploying the Round 2 fixes:
//
//   npx tsx scripts/fix-round2-data.ts
//
// 1. §2.5 — webhook tracking events were stored with Steadfast's Asia/Dhaka
//    "updated_at" read as UTC, skewing event_at +6h into the future. A webhook
//    arrives seconds after its event, so for every pre-fix row event_at sits
//    ~6h AFTER the row's own created_at; post-fix rows sit within minutes of
//    it. Rows in the 5–7h window are shifted back 6h — the window makes the
//    repair idempotent (a corrected row no longer matches).
// 2. §2.4 — placeholder riders: production tracking pages answer
//    rider {name: "Unassigned", phone: "0"} before a real assignment, and the
//    pre-fix gate stored them (faking ASSIGNED). Null those rider fields and
//    demote a rider-less ASSIGNED sub-state back to PENDING.
//
// Both steps are idempotent; re-running reports 0 changes.

import { prisma } from "../lib/db";

async function main() {
  // ---- §2.5: -6h for webhook-sourced tracking events stored pre-fix ----
  const skewFixed = await prisma.$executeRaw`
    UPDATE shipment_tracking_events
    SET event_at = event_at - interval '6 hours'
    WHERE source = 'WEBHOOK'
      AND event_at > created_at + interval '5 hours'
      AND event_at < created_at + interval '7 hours'
  `;
  console.log(`§2.5 tracking events shifted back 6h: ${skewFixed}`);

  // ---- §2.4: clear placeholder riders ----
  // Same placeholder test as lib/steadfast-constants.ts realRider(): a marker
  // name, or a "phone" with no dialable digits (production stored "0").
  const placeholders = await prisma.$queryRaw<
    { id: number; rider_name: string | null; rider_phone: string | null }[]
  >`
    SELECT id, rider_name, rider_phone FROM shipments
    WHERE rider_name IS NOT NULL
      AND (
        rider_name ~* '^(unassigned|not[ _-]?assigned|n/?a|none|-+)$'
        OR rider_phone IS NULL
        OR length(regexp_replace(rider_phone, '[^0-9]', '', 'g')) < 7
        OR regexp_replace(rider_phone, '[^0-9]', '', 'g') ~ '^0+$'
      )
  `;
  for (const s of placeholders) {
    console.log(
      `§2.4 shipment ${s.id}: clearing placeholder rider "${s.rider_name}" / "${s.rider_phone}"`
    );
  }
  if (placeholders.length > 0) {
    await prisma.shipment.updateMany({
      where: { id: { in: placeholders.map((s) => s.id) } },
      data: { riderName: null, riderPhone: null },
    });
  }

  // A rider-less ASSIGNED can only have come from a placeholder capture —
  // demote it to PENDING so the sub-tab/badge state is true in the DB too
  // (displayedCourierStatus already masks it in the UI, §R2).
  const demoted = await prisma.shipment.updateMany({
    where: { courierStatus: "ASSIGNED", riderName: null },
    data: { courierStatus: "PENDING" },
  });
  console.log(
    `§2.4 placeholder riders cleared: ${placeholders.length}, rider-less ASSIGNED demoted to PENDING: ${demoted.count}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
