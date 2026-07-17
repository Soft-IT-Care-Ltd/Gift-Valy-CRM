-- AlterEnum
ALTER TYPE "StatusLogSource" ADD VALUE 'API';

-- DropForeignKey
ALTER TABLE "courier_zone_charges" DROP CONSTRAINT "courier_zone_charges_courier_id_fkey";

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "courier_cost_estimated" DECIMAL(12,2),
ADD COLUMN     "delivery_zone" "DeliveryZone",
ADD COLUMN     "steadfast_weight_kg" DECIMAL(8,3),
ADD COLUMN     "tracking_page_checked_at" TIMESTAMP(3),
ADD COLUMN     "tracking_url" TEXT,
ADD COLUMN     "weight_kg" DECIMAL(8,3);

-- DropTable
DROP TABLE "courier_zone_charges";

-- CreateTable
CREATE TABLE "courier_zone_rates" (
    "id" SERIAL NOT NULL,
    "courier_id" INTEGER NOT NULL,
    "zone" "DeliveryZone" NOT NULL,
    "base_rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "per_kg_rate" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "courier_zone_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "courier_zone_rates_courier_id_zone_key" ON "courier_zone_rates"("courier_id", "zone");

-- AddForeignKey
ALTER TABLE "courier_zone_rates" ADD CONSTRAINT "courier_zone_rates_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

