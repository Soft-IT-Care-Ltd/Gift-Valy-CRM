-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_order_id_fkey";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "deleted_by" INTEGER;

-- CreateIndex
CREATE INDEX "orders_deleted_at_idx" ON "orders"("deleted_at");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the new orders.trash permission (CORRECTIONS Orders §6e/§6f) and grant
-- it to the Manager role. Admin needs only the permission row — the RBAC layer
-- gives Admin every existing permission automatically (lib/rbac.ts).
INSERT INTO "permissions" ("key")
VALUES ('orders.trash')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."name" = 'Manager' AND p."key" = 'orders.trash'
ON CONFLICT DO NOTHING;
