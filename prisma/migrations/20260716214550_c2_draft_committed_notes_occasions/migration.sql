-- CreateEnum
CREATE TYPE "DeliveryDateMode" AS ENUM ('ASAP', 'ANY_DAY', 'FIXED');

-- AlterEnum
ALTER TYPE "LeadStatus" ADD VALUE 'COMMITTED';

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "committed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "courier_note" TEXT,
ADD COLUMN     "delivery_date_mode" "DeliveryDateMode" NOT NULL DEFAULT 'ANY_DAY',
ADD COLUMN     "invoice_note" TEXT,
ALTER COLUMN "district" SET DEFAULT '',
ALTER COLUMN "thana" SET DEFAULT '';

-- Backfill: legacy orders that already carry a requested delivery date meant
-- "deliver ON that date" — mark them FIXED (everything else stays ANY_DAY).
UPDATE "orders" SET "delivery_date_mode" = 'FIXED' WHERE "requested_delivery_date" IS NOT NULL;

-- CreateTable
CREATE TABLE "customer_occasions" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "recipient_phone_bd" TEXT NOT NULL,
    "relation" TEXT,
    "birthday" DATE,
    "anniversary" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "customer_occasions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_occasions_birthday_idx" ON "customer_occasions"("birthday");

-- CreateIndex
CREATE INDEX "customer_occasions_anniversary_idx" ON "customer_occasions"("anniversary");

-- CreateIndex
CREATE UNIQUE INDEX "customer_occasions_customer_id_recipient_phone_bd_key" ON "customer_occasions"("customer_id", "recipient_phone_bd");

-- AddForeignKey
ALTER TABLE "customer_occasions" ADD CONSTRAINT "customer_occasions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
