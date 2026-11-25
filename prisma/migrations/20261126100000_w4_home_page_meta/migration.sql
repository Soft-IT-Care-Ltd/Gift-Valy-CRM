-- ROUND3 W-7 + W-8 — the home page manager (home_page), Meta Pixel +
-- Conversions API (meta_tracking, meta_events, meta_order_signals). Additive
-- only. Generated with `npm run db:diff` (SHADOW_DATABASE_URL only, CLAUDE.md
-- rule 8); the permission grant at the end is data, added by hand.

-- CreateEnum
CREATE TYPE "MetaEventStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "home_page" (
    "id" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "published_at" TIMESTAMP(3),
    "published_by" INTEGER,
    "draft_saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "draft_saved_by" INTEGER,

    CONSTRAINT "home_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_tracking" (
    "id" TEXT NOT NULL DEFAULT 'meta',
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "pixel_id" VARCHAR(20),
    "access_token_encrypted" TEXT,
    "test_event_code" VARCHAR(40),
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_events" (
    "id" SERIAL NOT NULL,
    "event_name" VARCHAR(40) NOT NULL,
    "event_id" VARCHAR(80) NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL,
    "pixel_id" VARCHAR(20) NOT NULL,
    "order_id" INTEGER,
    "payload" JSONB NOT NULL,
    "test_event_code" VARCHAR(40),
    "status" "MetaEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "response" JSONB,
    "error" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_order_signals" (
    "order_id" INTEGER NOT NULL,
    "user_data" JSONB NOT NULL,
    "event_source_url" VARCHAR(500) NOT NULL,
    "placed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_order_signals_pkey" PRIMARY KEY ("order_id")
);

-- CreateIndex
CREATE INDEX "meta_events_status_next_attempt_at_idx" ON "meta_events"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "meta_events_created_at_idx" ON "meta_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "meta_events_order_id_event_name_key" ON "meta_events"("order_id", "event_name");

-- AddForeignKey
ALTER TABLE "meta_events" ADD CONSTRAINT "meta_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_order_signals" ADD CONSTRAINT "meta_order_signals_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- W-7 — website.home: the home page manager. Admin holds every permission
-- automatically (lib/rbac.ts); the Manager role gets it here.
INSERT INTO "permissions" ("key")
VALUES ('website.home')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r, "permissions" p
 WHERE r."name" = 'Manager' AND p."key" = 'website.home'
ON CONFLICT DO NOTHING;
