-- CreateEnum
CREATE TYPE "StatusLogSource" AS ENUM ('WEBHOOK', 'POLL');

-- CreateEnum
CREATE TYPE "CourierIntegrationType" AS ENUM ('STEADFAST');

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "consignment_id" BIGINT,
ADD COLUMN     "last_polled_at" TIMESTAMP(3),
ADD COLUMN     "needs_attention" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "on_hold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "steadfast_status" TEXT;

-- CreateTable
CREATE TABLE "shipment_status_logs" (
    "id" SERIAL NOT NULL,
    "shipment_id" INTEGER,
    "raw_payload" JSONB NOT NULL,
    "raw_status" TEXT,
    "source" "StatusLogSource" NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_status_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_tracking_events" (
    "id" SERIAL NOT NULL,
    "shipment_id" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "event_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_integrations" (
    "id" SERIAL NOT NULL,
    "courier" "CourierIntegrationType" NOT NULL,
    "api_key_encrypted" TEXT,
    "secret_key_encrypted" TEXT,
    "webhook_token_encrypted" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "polling_minutes" INTEGER NOT NULL DEFAULT 60,
    "connected_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_webhook_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courier_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipment_status_logs_shipment_id_idx" ON "shipment_status_logs"("shipment_id");

-- CreateIndex
CREATE INDEX "shipment_tracking_events_shipment_id_idx" ON "shipment_tracking_events"("shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "courier_integrations_courier_key" ON "courier_integrations"("courier");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_consignment_id_key" ON "shipments"("consignment_id");

-- AddForeignKey
ALTER TABLE "shipment_status_logs" ADD CONSTRAINT "shipment_status_logs_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_tracking_events" ADD CONSTRAINT "shipment_tracking_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

