-- PHOTO_PRINT.md PP-4 — the customer photos and wishing cards of each print
-- kit. Additive only: two counters on order_print_kits and two new tables.
-- Photos uploaded on an unsaved order form are "staged" (kit_id NULL) until
-- the order is saved.
-- AlterTable
ALTER TABLE "order_print_kits" ADD COLUMN     "card_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "photo_count" INTEGER NOT NULL DEFAULT 0;
-- CreateTable
CREATE TABLE "order_print_photos" (
    "id" SERIAL NOT NULL,
    "kit_id" INTEGER,
    "slot" "PrintSlot",
    "position" INTEGER,
    "stage_token" TEXT,
    "staged_by" INTEGER,
    "original_path" TEXT NOT NULL,
    "print_path" TEXT,
    "src_width" INTEGER NOT NULL,
    "src_height" INTEGER NOT NULL,
    "src_bytes" INTEGER NOT NULL,
    "crop" JSONB NOT NULL,
    "low_res" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "order_print_photos_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "order_print_cards" (
    "id" SERIAL NOT NULL,
    "kit_id" INTEGER NOT NULL,
    "slot" "PrintSlot" NOT NULL,
    "design_id" INTEGER NOT NULL,
    "message_id" INTEGER,
    "text" TEXT NOT NULL,
    "to_name" TEXT,
    "from_name" TEXT,
    "render_path" TEXT,
    "font_pt" DECIMAL(4,1),
    "updated_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "order_print_cards_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "order_print_photos_stage_token_idx" ON "order_print_photos"("stage_token");
-- CreateIndex
CREATE INDEX "order_print_photos_created_at_idx" ON "order_print_photos"("created_at");
-- CreateIndex
CREATE UNIQUE INDEX "order_print_photos_kit_id_slot_position_key" ON "order_print_photos"("kit_id", "slot", "position");
-- CreateIndex
CREATE UNIQUE INDEX "order_print_cards_kit_id_slot_key" ON "order_print_cards"("kit_id", "slot");
-- CreateIndex
CREATE INDEX "order_print_kits_order_id_idx" ON "order_print_kits"("order_id");
-- AddForeignKey
ALTER TABLE "order_print_photos" ADD CONSTRAINT "order_print_photos_kit_id_fkey" FOREIGN KEY ("kit_id") REFERENCES "order_print_kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "order_print_cards" ADD CONSTRAINT "order_print_cards_kit_id_fkey" FOREIGN KEY ("kit_id") REFERENCES "order_print_kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "order_print_cards" ADD CONSTRAINT "order_print_cards_design_id_fkey" FOREIGN KEY ("design_id") REFERENCES "card_designs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "order_print_cards" ADD CONSTRAINT "order_print_cards_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "card_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
