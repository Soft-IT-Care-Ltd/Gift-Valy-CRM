-- CreateEnum
CREATE TYPE "CourierStatus" AS ENUM ('PENDING', 'ASSIGNED', 'DELIVERY_APPROVAL_PENDING', 'RETURN_APPROVAL_PENDING');

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "courier_status" "CourierStatus",
ADD COLUMN     "return_received_at" TIMESTAMP(3),
ADD COLUMN     "return_received_by" INTEGER,
ADD COLUMN     "rider_name" TEXT,
ADD COLUMN     "rider_phone" TEXT;

-- CreateTable
CREATE TABLE "damage_logs" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_cost" DECIMAL(12,2) NOT NULL,
    "order_id" INTEGER,
    "shipment_id" INTEGER,
    "note" TEXT,
    "inspected_by" INTEGER NOT NULL,
    "inspected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "damage_logs_inspected_at_idx" ON "damage_logs"("inspected_at");

-- CreateIndex
CREATE INDEX "damage_logs_product_id_idx" ON "damage_logs"("product_id");

-- AddForeignKey
ALTER TABLE "damage_logs" ADD CONSTRAINT "damage_logs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_logs" ADD CONSTRAINT "damage_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_logs" ADD CONSTRAINT "damage_logs_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_logs" ADD CONSTRAINT "damage_logs_inspected_by_fkey" FOREIGN KEY ("inspected_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill (CORRECTIONS Orders §6m/§6n):
-- 1. Shipments still In Transit whose last Steadfast status was pending/hold
--    enter the new sub-state machine at PENDING.
UPDATE "shipments" SET "courier_status" = 'PENDING'
WHERE "status" = 'IN_TRANSIT'
  AND lower(coalesce("steadfast_status", '')) IN ('pending', 'hold');

-- 2. Legacy Admin-approved returns already restored their stock — they count as
--    Received so they land on the Received sub-tab, not back in Pending.
UPDATE "shipments"
SET "return_received_at" = "return_approved_at",
    "return_received_by" = "return_approved_by"
WHERE "return_approved" = true AND "return_received_at" IS NULL;
