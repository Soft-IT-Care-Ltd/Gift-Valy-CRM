-- CORRECTIONS Orders §R8 — Steadfast Payments sync (automatic COD payout
-- reconciliation). One row per payout invoice (GET /payments) + one row per
-- cleared consignment inside it (GET /payments/{id}). Response shapes are not
-- fully documented upstream, so the first raw list/detail payloads are stored
-- verbatim for shape discovery and everything is parsed defensively.

CREATE TYPE "SteadfastPaymentStatus" AS ENUM ('PROCESSING', 'PAID');

CREATE TABLE "steadfast_payments" (
    "id" SERIAL NOT NULL,
    "steadfast_payment_id" BIGINT NOT NULL,
    "invoice_no" TEXT,
    "status" "SteadfastPaymentStatus" NOT NULL DEFAULT 'PROCESSING',
    "payment_date" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "amount_delivered" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "delivery_charge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cod_charge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "available_balance" DECIMAL(12,2),
    "parcel_count" INTEGER NOT NULL DEFAULT 0,
    "wallet_id" INTEGER,
    "reconciled_at" TIMESTAMP(3),
    "delivery_charge_expense_id" INTEGER,
    "cod_charge_expense_id" INTEGER,
    "raw_payload" JSONB,
    "raw_detail_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "steadfast_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "steadfast_payment_items" (
    "id" SERIAL NOT NULL,
    "payment_id" INTEGER NOT NULL,
    "consignment_id" BIGINT,
    "invoice" TEXT,
    "cod_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "delivery_charge" DECIMAL(12,2),
    "status" TEXT,
    "shipment_id" INTEGER,
    "order_id" INTEGER,
    "order_payment_id" INTEGER,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "steadfast_payment_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "steadfast_payments_steadfast_payment_id_key" ON "steadfast_payments"("steadfast_payment_id");
CREATE INDEX "steadfast_payments_status_payment_date_idx" ON "steadfast_payments"("status", "payment_date");

CREATE UNIQUE INDEX "steadfast_payment_items_payment_id_consignment_id_key" ON "steadfast_payment_items"("payment_id", "consignment_id");
CREATE INDEX "steadfast_payment_items_shipment_id_idx" ON "steadfast_payment_items"("shipment_id");
CREATE INDEX "steadfast_payment_items_consignment_id_idx" ON "steadfast_payment_items"("consignment_id");

ALTER TABLE "steadfast_payments"
  ADD CONSTRAINT "steadfast_payments_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "steadfast_payment_items"
  ADD CONSTRAINT "steadfast_payment_items_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "steadfast_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "steadfast_payment_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "steadfast_payment_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "steadfast_payment_items_order_payment_id_fkey" FOREIGN KEY ("order_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The hourly payments poll keeps its own clock so the */15 status cron can host
-- it without over-calling GET /payments.
ALTER TABLE "courier_integrations"
  ADD COLUMN "last_payments_sync_at" TIMESTAMP(3);
