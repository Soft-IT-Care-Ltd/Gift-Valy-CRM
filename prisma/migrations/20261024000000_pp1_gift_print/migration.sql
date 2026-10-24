-- PHOTO_PRINT.md PP-1 / PP-2 / PP-3 / PP-5 — Customize Chocolate Box photo +
-- wishing-card print. Additive only: four enums, one nullable column on
-- products, three new tables, and the three print.* permissions. Print sizes
-- and the layout choice are rows in "settings" (code defaults until saved),
-- so they need no DDL. Photo and card rows per kit come with PP-4.

-- CreateEnum
CREATE TYPE "PrintSlot" AS ENUM ('PHOTO_L', 'PHOTO_S', 'CARD_1', 'CARD_2');

-- CreateEnum
CREATE TYPE "CardLanguage" AS ENUM ('BN', 'EN', 'MIXED');

-- CreateEnum
CREATE TYPE "CardTextAlign" AS ENUM ('LEFT', 'CENTER', 'RIGHT');

-- CreateEnum
CREATE TYPE "PrintKitStatus" AS ENUM ('PENDING', 'READY', 'PRINTED', 'CHANGED_AFTER_PRINT');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "print_kit" JSONB;

-- CreateTable
CREATE TABLE "card_designs" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slot" "PrintSlot" NOT NULL,
    "background_path" TEXT,
    "text_box" JSONB NOT NULL,
    "text_color" TEXT NOT NULL DEFAULT '#be185d',
    "align" "CardTextAlign" NOT NULL DEFAULT 'CENTER',
    "font_path" TEXT,
    "max_font_pt" DECIMAL(4,1) NOT NULL DEFAULT 16,
    "min_font_pt" DECIMAL(4,1) NOT NULL DEFAULT 9,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "card_designs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_messages" (
    "id" SERIAL NOT NULL,
    "occasion" TEXT NOT NULL,
    "language" "CardLanguage" NOT NULL,
    "text" TEXT NOT NULL,
    "has_name_slots" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "card_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_print_kits" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "source_key" TEXT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "spec_snapshot" JSONB NOT NULL,
    "status" "PrintKitStatus" NOT NULL DEFAULT 'PENDING',
    "print_hash" TEXT,
    "printed_at" TIMESTAMP(3),
    "printed_by" INTEGER,
    "print_count" INTEGER NOT NULL DEFAULT 0,
    "orphaned_at" TIMESTAMP(3),
    "files_purged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_print_kits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "card_designs_slot_is_active_idx" ON "card_designs"("slot", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "card_messages_text_key" ON "card_messages"("text");

-- CreateIndex
CREATE INDEX "card_messages_occasion_is_active_idx" ON "card_messages"("occasion", "is_active");

-- CreateIndex
CREATE INDEX "order_print_kits_status_idx" ON "order_print_kits"("status");

-- CreateIndex
CREATE UNIQUE INDEX "order_print_kits_order_id_source_key_key" ON "order_print_kits"("order_id", "source_key");

-- AddForeignKey
ALTER TABLE "order_print_kits" ADD CONSTRAINT "order_print_kits_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_print_kits" ADD CONSTRAINT "order_print_kits_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PP-5 — the print permissions, granted to existing roles so production
-- matches the seed matrix (lib/permissions.ts); prisma/bootstrap.ts only seeds
-- roles that don't exist yet. Admin holds every permission automatically
-- (lib/rbac.ts). Print sizes and layouts stay on settings.manage (Admin).
INSERT INTO "permissions" ("key")
VALUES ('print.edit'), ('print.print'), ('print.settings')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r
  JOIN "permissions" p ON (r."name", p."key") IN (
    ('Manager', 'print.edit'),
    ('TeamLeader', 'print.edit'),
    ('SalesExecutive', 'print.edit'),
    ('Manager', 'print.print'),
    ('Packing', 'print.print'),
    ('Manager', 'print.settings')
  )
ON CONFLICT DO NOTHING;
