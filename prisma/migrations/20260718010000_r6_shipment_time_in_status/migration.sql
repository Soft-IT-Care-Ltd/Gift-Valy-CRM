-- CORRECTIONS Orders §R6 — time-in-status tracking for In Transit parcels.
-- Two timestamps per shipment feed the Duration column, the stuck filter/sort
-- and the stuck-parcels count:
--   in_transit_at     — when the parcel first reached IN_TRANSIT (warehouse
--                       receive) → TOTAL time in transit.
--   courier_status_at — the last change of courier_status → time in the
--                       CURRENT sub-status (Pending/Assigned/…-approval-pending).
ALTER TABLE "shipments"
  ADD COLUMN "in_transit_at" TIMESTAMP(3),
  ADD COLUMN "courier_status_at" TIMESTAMP(3);

-- Backfill existing rows so the durations render immediately (no waiting for the
-- next status change). in_transit_at = the latest order_status_history entry
-- that moved the order into IN_TRANSIT; the current sub-status clock starts from
-- that same instant when unknown, else from the row's last update.
UPDATE "shipments" s
SET "in_transit_at" = sub."at"
FROM (
  SELECT "order_id", MAX("at") AS "at"
  FROM "order_status_history"
  WHERE "to_status" = 'IN_TRANSIT'
  GROUP BY "order_id"
) sub
WHERE s."order_id" = sub."order_id";

UPDATE "shipments"
SET "courier_status_at" = COALESCE("in_transit_at", "updated_at")
WHERE "courier_status" IS NOT NULL OR "in_transit_at" IS NOT NULL;
