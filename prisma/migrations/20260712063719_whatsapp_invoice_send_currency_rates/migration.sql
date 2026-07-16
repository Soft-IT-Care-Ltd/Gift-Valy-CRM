-- CreateEnum
CREATE TYPE "WhatsAppTrigger" AS ENUM ('AUTO_CONFIRM', 'AUTO_EDIT', 'MANUAL');

-- CreateEnum
CREATE TYPE "WhatsAppSendStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "whatsapp_integrations" (
    "id" SERIAL NOT NULL,
    "phone_number_id" TEXT,
    "access_token_encrypted" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_send_invoice" BOOLEAN NOT NULL DEFAULT true,
    "connected_at" TIMESTAMP(3),
    "last_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "invoice_id" INTEGER,
    "to_phone" TEXT NOT NULL,
    "trigger" "WhatsAppTrigger" NOT NULL,
    "status" "WhatsAppSendStatus" NOT NULL,
    "wa_message_id" TEXT,
    "error" TEXT,
    "sent_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_rates" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "bdt_per_unit" DECIMAL(12,4) NOT NULL,
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" INTEGER,

    CONSTRAINT "currency_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_messages_order_id_created_at_idx" ON "whatsapp_messages"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_messages_created_at_idx" ON "whatsapp_messages"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "currency_rates_code_key" ON "currency_rates"("code");

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
