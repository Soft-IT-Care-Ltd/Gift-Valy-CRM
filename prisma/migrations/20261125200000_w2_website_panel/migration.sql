-- ROUND3 W-2 — the Website panel on products, packages and categories.
-- Additive only: new columns/tables + a data backfill (no row is deleted).

-- CreateEnum
CREATE TYPE "WebsiteBadge" AS ENUM ('NONE', 'NEW', 'BEST_SELLER', 'LIMITED');

-- CreateEnum
CREATE TYPE "WebsiteSlugSpace" AS ENUM ('ITEM', 'CATEGORY');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "seo_description" TEXT,
ADD COLUMN     "seo_title" TEXT,
ADD COLUMN     "show_on_website" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "slug_published_at" TIMESTAMP(3),
ADD COLUMN     "website_description" TEXT,
ADD COLUMN     "website_featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "website_name" TEXT,
ADD COLUMN     "website_sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "packages" ADD COLUMN     "compare_at_price" DECIMAL(12,2),
ADD COLUMN     "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "seo_description" TEXT,
ADD COLUMN     "seo_title" TEXT,
ADD COLUMN     "show_on_website" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "slug_published_at" TIMESTAMP(3),
ADD COLUMN     "website_badge" "WebsiteBadge" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "website_description" TEXT,
ADD COLUMN     "website_featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "website_name" TEXT,
ADD COLUMN     "website_show_contents" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "website_sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "compare_at_price" DECIMAL(12,2),
ADD COLUMN     "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "seo_description" TEXT,
ADD COLUMN     "seo_title" TEXT,
ADD COLUMN     "show_on_website" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "slug_published_at" TIMESTAMP(3),
ADD COLUMN     "website_badge" "WebsiteBadge" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "website_description" TEXT,
ADD COLUMN     "website_featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "website_name" TEXT,
ADD COLUMN     "website_sort_order" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "package_website_categories" (
    "package_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,

    CONSTRAINT "package_website_categories_pkey" PRIMARY KEY ("package_id","category_id")
);

-- CreateTable
CREATE TABLE "website_slug_redirects" (
    "id" SERIAL NOT NULL,
    "space" "WebsiteSlugSpace" NOT NULL,
    "slug" TEXT NOT NULL,
    "product_id" INTEGER,
    "package_id" INTEGER,
    "category_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_slug_redirects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "package_website_categories_category_id_idx" ON "package_website_categories"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "website_slug_redirects_space_slug_key" ON "website_slug_redirects"("space", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "packages_slug_key" ON "packages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- AddForeignKey
ALTER TABLE "package_website_categories" ADD CONSTRAINT "package_website_categories_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_website_categories" ADD CONSTRAINT "package_website_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_slug_redirects" ADD CONSTRAINT "website_slug_redirects_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_slug_redirects" ADD CONSTRAINT "website_slug_redirects_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_slug_redirects" ADD CONSTRAINT "website_slug_redirects_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- An old address points at exactly one thing.
ALTER TABLE "website_slug_redirects" ADD CONSTRAINT "website_slug_redirects_one_target"
  CHECK (num_nonnulls("product_id", "package_id", "category_id") = 1);

-- The existing photo becomes the first website photo.
UPDATE "products" SET "photos" = ARRAY["photo_url"] WHERE "photo_url" IS NOT NULL AND "photo_url" <> '';
UPDATE "packages" SET "photos" = ARRAY["photo_url"] WHERE "photo_url" IS NOT NULL AND "photo_url" <> '';

-- Owner's decision (25 Nov 2026): every active SELLABLE product and every
-- active package is on the website from day one; COMPONENT products and
-- inactive items stay off. Addresses (slugs) are made by the app — Bangla
-- names need transliteration (lib/storefront/slug.ts) — the first time the
-- public catalog reads a shown item without one (lib/storefront/catalog.ts).
UPDATE "products" SET "show_on_website" = ("product_type" = 'SELLABLE' AND "is_active");
UPDATE "packages" SET "show_on_website" = "is_active";
