-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('FACEBOOK_AD', 'MESSENGER', 'WHATSAPP', 'INSTAGRAM', 'REFERRAL', 'REPEAT_CUSTOMER', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'FOLLOW_UP', 'NEGOTIATING', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "LostReason" AS ENUM ('PRICE', 'TRUST', 'DELIVERY_TIME', 'OUT_OF_AREA', 'NO_RESPONSE', 'OTHER');

-- CreateTable
CREATE TABLE "leads" (
    "id" SERIAL NOT NULL,
    "lead_date" DATE NOT NULL,
    "source" "LeadSource" NOT NULL,
    "campaign_name" TEXT,
    "customer_name" TEXT,
    "country" TEXT,
    "whatsapp_number" TEXT NOT NULL,
    "interested_in" JSONB,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "follow_up_at" TIMESTAMP(3),
    "lost_reason" "LostReason",
    "notes" TEXT,
    "assigned_to" INTEGER NOT NULL,
    "team_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_daily_counts" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "user_id" INTEGER NOT NULL,
    "source" "LeadSource" NOT NULL,
    "campaign_name" TEXT,
    "count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "lead_daily_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_assigned_to_status_idx" ON "leads"("assigned_to", "status");

-- CreateIndex
CREATE INDEX "leads_team_id_status_idx" ON "leads"("team_id", "status");

-- CreateIndex
CREATE INDEX "leads_whatsapp_number_idx" ON "leads"("whatsapp_number");

-- CreateIndex
CREATE INDEX "leads_follow_up_at_idx" ON "leads"("follow_up_at");

-- CreateIndex
CREATE INDEX "leads_lead_date_idx" ON "leads"("lead_date");

-- CreateIndex
CREATE INDEX "lead_daily_counts_date_idx" ON "lead_daily_counts"("date");

-- CreateIndex
CREATE INDEX "lead_daily_counts_user_id_date_idx" ON "lead_daily_counts"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "orders_lead_id_key" ON "orders"("lead_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_daily_counts" ADD CONSTRAINT "lead_daily_counts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

