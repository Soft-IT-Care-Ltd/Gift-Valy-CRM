-- AlterTable
ALTER TABLE "order_print_kits" ADD COLUMN     "package_id" INTEGER,
ALTER COLUMN "product_id" DROP NOT NULL;
-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "print_kit" JSONB;
-- AddForeignKey
ALTER TABLE "order_print_kits" ADD CONSTRAINT "order_print_kits_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A kit comes from exactly one place: a kit-carrying product, or a package's own kit.
ALTER TABLE "order_print_kits" ADD CONSTRAINT "order_print_kits_one_source" CHECK (("product_id" IS NULL) <> ("package_id" IS NULL));
