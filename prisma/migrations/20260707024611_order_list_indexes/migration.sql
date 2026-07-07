-- DropIndex
DROP INDEX "orders_sales_executive_id_idx";

-- DropIndex
DROP INDEX "orders_status_idx";

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_sales_executive_id_created_at_idx" ON "orders"("sales_executive_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_team_id_created_at_idx" ON "orders"("team_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_recipient_phone_bd_idx" ON "orders"("recipient_phone_bd");
