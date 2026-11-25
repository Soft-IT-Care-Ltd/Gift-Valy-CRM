-- ROUND3 W-5/W-6 — website orders: the order's source, its stable reference and
-- private link, what the customer typed, the bell (notifications), the WEBSITE
-- lead source, the website cancel reasons, and orders.assign.
-- Additive only: new enum values, nullable/defaulted columns, a new table and a
-- permission grant. No row is changed or deleted; the order counter is untouched.

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('STAFF', 'WEBSITE');

-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE 'WEBSITE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LostReason" ADD VALUE 'FAKE_ORDER';
ALTER TYPE "LostReason" ADD VALUE 'DUPLICATE';
ALTER TYPE "LostReason" ADD VALUE 'CHANGED_MIND';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "placed_ip" TEXT,
ADD COLUMN     "source" "OrderSource" NOT NULL DEFAULT 'STAFF',
ADD COLUMN     "web_assign_reason" TEXT,
ADD COLUMN     "web_assigned_at" TIMESTAMP(3),
ADD COLUMN     "web_contact" JSONB,
ADD COLUMN     "web_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "web_ref" TEXT,
ADD COLUMN     "web_token" TEXT;

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_web_ref_key" ON "orders"("web_ref");

-- CreateIndex
CREATE UNIQUE INDEX "orders_web_token_key" ON "orders"("web_token");

-- CreateIndex
CREATE INDEX "orders_source_status_idx" ON "orders"("source", "status");

-- CreateIndex
CREATE INDEX "orders_placed_ip_created_at_idx" ON "orders"("placed_ip", "created_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- W-6 — orders.assign: hand a website order (still a draft) to a Sales
-- Executive. Manager and Team Leader; Admin holds every permission
-- automatically (lib/rbac.ts).
INSERT INTO "permissions" ("key")
VALUES ('orders.assign')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r, "permissions" p
 WHERE r."name" IN ('Manager', 'TeamLeader') AND p."key" = 'orders.assign'
ON CONFLICT DO NOTHING;
