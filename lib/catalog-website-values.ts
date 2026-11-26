import type { Prisma } from "@prisma/client";
import type { WebsiteBadgeValue, WebsiteValues } from "./catalog-website-shape";

// ROUND3 W-2 — the Website panel's stored columns → what the ERP's lists and
// edit dialogs read (lib/catalog.ts serializers). Pure: no database, no fs.

// ---------- reading back for the ERP ----------

type WebsiteRow = {
  showOnWebsite: boolean;
  websiteName: string | null;
  slug: string | null;
  slugPublishedAt: Date | null;
  websiteDescription: string | null;
  websiteFeatured: boolean;
  websiteSortOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
  photos?: string[];
  compareAtPrice?: Prisma.Decimal | null;
  websiteBadge?: WebsiteBadgeValue;
  websiteShowContents?: boolean;
  websiteCategories?: { categoryId: number }[];
};

/** The Website panel's values for the ERP's lists and edit dialogs. */
export function websiteValues(row: WebsiteRow): WebsiteValues {
  return {
    showOnWebsite: row.showOnWebsite,
    websiteName: row.websiteName,
    slug: row.slug,
    slugPublished: row.slugPublishedAt != null,
    websiteDescription: row.websiteDescription,
    photos: row.photos ?? [],
    compareAtPrice: row.compareAtPrice == null ? null : Number(row.compareAtPrice),
    websiteBadge: row.websiteBadge ?? "NONE",
    websiteFeatured: row.websiteFeatured,
    websiteSortOrder: row.websiteSortOrder,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    websiteCategoryIds: (row.websiteCategories ?? []).map((c) => c.categoryId),
    websiteShowContents: row.websiteShowContents ?? true,
  };
}

/**
 * The bulk Website switch: does this row need applyWebsite()? When its state
 * differs — and also when it is to be shown but has no address yet. Rows made
 * before the website existed (W-2's migration) are "Show on website" on by
 * default with no slug, so they are not on the website; "Show on website"
 * must give them their address rather than skip them as already shown.
 */
export function bulkWebsiteNeedsApply(row: { showOnWebsite: boolean; slug: string | null }, show: boolean): boolean {
  return row.showOnWebsite !== show || (show && !row.slug);
}

/** Why a product can't be on the website, or null. */
export function productWebsiteBlock(productType: string): string | null {
  return productType === "COMPONENT" ? "Component-only products (packing materials) are never sold on the website" : null;
}
