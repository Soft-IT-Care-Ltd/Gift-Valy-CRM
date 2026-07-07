-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('HANDED_TO_COURIER', 'IN_TRANSIT', 'DELIVERED', 'RETURNED');

-- CreateTable
CREATE TABLE "couriers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "cod_fee_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "couriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_zone_charges" (
    "id" SERIAL NOT NULL,
    "courier_id" INTEGER NOT NULL,
    "district" TEXT NOT NULL,
    "charge" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "courier_zone_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "courier_id" INTEGER NOT NULL,
    "tracking_no" TEXT,
    "handover_date" DATE NOT NULL,
    "cod_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expected_delivery" DATE,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'HANDED_TO_COURIER',
    "delivered_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "courier_cost_actual" DECIMAL(12,2),
    "cod_received" BOOLEAN NOT NULL DEFAULT false,
    "cod_received_at" TIMESTAMP(3),
    "cod_fee_expense_id" INTEGER,
    "return_approved" BOOLEAN NOT NULL DEFAULT false,
    "return_approved_at" TIMESTAMP(3),
    "return_approved_by" INTEGER,
    "return_charge" DECIMAL(12,2),
    "return_charge_expense_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "couriers_name_key" ON "couriers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "courier_zone_charges_courier_id_district_key" ON "courier_zone_charges"("courier_id", "district");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_order_id_key" ON "shipments"("order_id");

-- CreateIndex
CREATE INDEX "shipments_status_idx" ON "shipments"("status");

-- CreateIndex
CREATE INDEX "shipments_courier_id_idx" ON "shipments"("courier_id");

-- AddForeignKey
ALTER TABLE "courier_zone_charges" ADD CONSTRAINT "courier_zone_charges_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
