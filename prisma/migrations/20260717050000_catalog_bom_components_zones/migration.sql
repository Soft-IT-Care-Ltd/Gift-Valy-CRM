-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('SELLABLE', 'COMPONENT');

-- CreateEnum
CREATE TYPE "DeliveryZone" AS ENUM ('INSIDE_DHAKA', 'SUB_DHAKA', 'OUTSIDE_DHAKA');

-- CreateEnum
CREATE TYPE "PackageItemKind" AS ENUM ('PRODUCT', 'PACKAGE', 'CHOICE');

-- DropForeignKey
ALTER TABLE "package_items" DROP CONSTRAINT "package_items_product_id_fkey";

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "choice_selections" JSONB;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivery_zone" "DeliveryZone";

-- AlterTable
ALTER TABLE "package_items" ADD COLUMN     "child_package_id" INTEGER,
ADD COLUMN     "choice_label" TEXT,
ADD COLUMN     "kind" "PackageItemKind" NOT NULL DEFAULT 'PRODUCT',
ALTER COLUMN "product_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "delivery_charge_inside_dhaka" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "delivery_charge_outside_dhaka" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "delivery_charge_sub_dhaka" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "weight_kg" DECIMAL(8,3);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "delivery_charge_inside_dhaka" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "delivery_charge_outside_dhaka" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "delivery_charge_sub_dhaka" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "product_type" "ProductType" NOT NULL DEFAULT 'SELLABLE',
ADD COLUMN     "weight_kg" DECIMAL(8,3);

-- CreateTable
CREATE TABLE "product_components" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "component_id" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "product_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_item_options" (
    "id" SERIAL NOT NULL,
    "package_item_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "package_item_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_components_product_id_component_id_key" ON "product_components"("product_id", "component_id");

-- CreateIndex
CREATE UNIQUE INDEX "package_item_options_package_item_id_product_id_key" ON "package_item_options"("package_item_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "package_items_package_id_child_package_id_key" ON "package_items"("package_id", "child_package_id");

-- AddForeignKey
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_components" ADD CONSTRAINT "product_components_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_items" ADD CONSTRAINT "package_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_items" ADD CONSTRAINT "package_items_child_package_id_fkey" FOREIGN KEY ("child_package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_item_options" ADD CONSTRAINT "package_item_options_package_item_id_fkey" FOREIGN KEY ("package_item_id") REFERENCES "package_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_item_options" ADD CONSTRAINT "package_item_options_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

