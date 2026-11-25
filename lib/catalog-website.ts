import { existsSync } from "node:fs";
import type { Prisma } from "@prisma/client";
import { logAuditTx } from "./audit";
import { AuthzError } from "./authz";
import { uploadUrlPath } from "./file-storage";
import {
  type WebsiteInput,
  type WebsiteBadgeValue,
} from "./catalog-website-shape";
import { SLUG_PATTERN, firstFreeSlug, productSlugBase, slugify } from "./storefront/slug";

// ROUND3 W-2 — the Website panel on the product, package and category forms,
// Create and Edit alike. One server path for all three: the create / PATCH
// routes call applyWebsite() inside their own transaction, and so does the
// bulk Show / Hide. Every change writes one audit row "catalog.website" with
// the website fields before and after.
//
// Addresses: products and packages share /p/<slug> (one space), categories
// have /c/<slug>. A slug is made from the website name (else the name;
// Bangla transliterated) until the item is first shown — from then on it is
// fixed, and a manual change keeps the old address as a permanent redirect
// (website_slug_redirects).

type Tx = Prisma.TransactionClient;
export type WebsiteKind = "product" | "package" | "category";

/** A Website panel value the server refuses — answered as 400 by apiError. */
export class WebsiteInputError extends AuthzError {
  constructor(message: string) {
    super(400, message);
  }
}

const ENTITY: Record<WebsiteKind, string> = { product: "products", package: "packages", category: "categories" };

/** The website columns of one row, as stored. */
const COLUMNS = {
  showOnWebsite: true,
  websiteName: true,
  slug: true,
  slugPublishedAt: true,
  websiteDescription: true,
  websiteFeatured: true,
  websiteSortOrder: true,
  seoTitle: true,
  seoDescription: true,
} as const;
const ITEM_COLUMNS = { ...COLUMNS, photos: true, compareAtPrice: true, websiteBadge: true } as const;

type StoredWebsite = {
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
  websiteCategoryIds?: number[];
};

async function readStored(tx: Tx, kind: WebsiteKind, id: number): Promise<StoredWebsite | null> {
  if (kind === "product") return tx.product.findUnique({ where: { id }, select: ITEM_COLUMNS });
  if (kind === "category") return tx.category.findUnique({ where: { id }, select: COLUMNS });
  const row = await tx.package.findUnique({
    where: { id },
    select: { ...ITEM_COLUMNS, websiteShowContents: true, websiteCategories: { select: { categoryId: true }, orderBy: { categoryId: "asc" } } },
  });
  if (!row) return null;
  const { websiteCategories, ...rest } = row;
  return { ...rest, websiteCategoryIds: websiteCategories.map((c) => c.categoryId) };
}

/** Audit-friendly snapshot (Decimals → numbers, dates → ISO). */
function snapshot(s: StoredWebsite) {
  return {
    ...s,
    slugPublishedAt: s.slugPublishedAt?.toISOString() ?? null,
    compareAtPrice: s.compareAtPrice == null ? s.compareAtPrice : Number(s.compareAtPrice),
  };
}

// ---------- addresses ----------

const space = (kind: WebsiteKind): "CATEGORY" | "ITEM" => (kind === "category" ? "CATEGORY" : "ITEM");

/** Is `slug` used in this kind's address space by anything other than `self`? */
export async function slugTaken(tx: Tx, kind: WebsiteKind, slug: string, selfId: number | null): Promise<boolean> {
  if (kind === "category") {
    const [cat, redirect] = await Promise.all([
      tx.category.findFirst({ where: { slug, ...(selfId != null ? { NOT: { id: selfId } } : {}) }, select: { id: true } }),
      tx.websiteSlugRedirect.findFirst({ where: { space: "CATEGORY", slug, ...(selfId != null ? { NOT: { categoryId: selfId } } : {}) }, select: { id: true } }),
    ]);
    return Boolean(cat || redirect);
  }
  const notSelfProduct = kind === "product" && selfId != null ? { NOT: { id: selfId } } : {};
  const notSelfPackage = kind === "package" && selfId != null ? { NOT: { id: selfId } } : {};
  const [p, k, r] = await Promise.all([
    tx.product.findFirst({ where: { slug, ...notSelfProduct }, select: { id: true } }),
    tx.package.findFirst({ where: { slug, ...notSelfPackage }, select: { id: true } }),
    tx.websiteSlugRedirect.findFirst({ where: { space: "ITEM", slug }, select: { productId: true, packageId: true } }),
  ]);
  const redirectIsSelf =
    r != null && selfId != null && ((kind === "product" && r.productId === selfId) || (kind === "package" && r.packageId === selfId));
  return Boolean(p || k || (r && !redirectIsSelf));
}

/** A free slug made from the item's name (Bangla transliterated). */
export async function autoSlug(tx: Tx, kind: WebsiteKind, id: number | null, name: string, code: string | null): Promise<string> {
  const base = kind === "category" ? slugify(name) || "category" : productSlugBase(name, code ?? "item");
  return firstFreeSlug(base, kind === "category" ? null : code, (s) => slugTaken(tx, kind, s, id));
}

async function writeSlug(tx: Tx, kind: WebsiteKind, id: number, data: { slug: string | null; slugPublishedAt: Date | null }) {
  if (kind === "product") await tx.product.update({ where: { id }, data });
  else if (kind === "package") await tx.package.update({ where: { id }, data });
  else await tx.category.update({ where: { id }, data });
}

/**
 * Gives a shown item without an address its first one (items the W-2
 * migration switched on, whose Bangla names SQL can't transliterate). Called
 * by the public catalog; idempotent and cheap when nothing is missing.
 */
export async function ensureWebsiteSlugs(tx: Tx): Promise<number> {
  let made = 0;
  const now = new Date();
  const [products, packages, categories] = await Promise.all([
    tx.product.findMany({ where: { showOnWebsite: true, slug: null }, select: { id: true, name: true, websiteName: true, sku: true } }),
    tx.package.findMany({ where: { showOnWebsite: true, slug: null }, select: { id: true, name: true, websiteName: true, code: true } }),
    tx.category.findMany({ where: { showOnWebsite: true, slug: null }, select: { id: true, name: true, websiteName: true } }),
  ]);
  for (const p of products) {
    await writeSlug(tx, "product", p.id, { slug: await autoSlug(tx, "product", p.id, p.websiteName || p.name, p.sku), slugPublishedAt: now });
    made++;
  }
  for (const p of packages) {
    await writeSlug(tx, "package", p.id, { slug: await autoSlug(tx, "package", p.id, p.websiteName || p.name, p.code), slugPublishedAt: now });
    made++;
  }
  for (const c of categories) {
    await writeSlug(tx, "category", c.id, { slug: await autoSlug(tx, "category", c.id, c.websiteName || c.name, null), slugPublishedAt: now });
    made++;
  }
  return made;
}

// ---------- the one write ----------

export interface WebsiteContext {
  userId: number;
  /** The ERP name and SKU / package code (address fallback). */
  name: string;
  code: string | null;
  /** Selling price — the compare-at price must be above it. */
  price: number | null;
  /** Why it can't be shown (COMPONENT product), or null when it can. */
  notEligible: string | null;
  /** Whether the item is active (shown + inactive = stored, not published). */
  isActive: boolean;
  /** true on create: the item is brand new (no before row for the audit). */
  created?: boolean;
}

/** A photo the form may store: one of ours under /uploads, on disk. Photos already on the item are kept as they are. */
function assertPhotos(photos: string[], before: string[]) {
  if (new Set(photos).size !== photos.length) throw new WebsiteInputError("The same photo is in the list twice");
  for (const url of photos) {
    if (before.includes(url)) continue;
    const file = uploadUrlPath(url);
    if (!file || !existsSync(file)) throw new WebsiteInputError("Upload the photo again — that file isn't one of ours");
  }
}

/**
 * Applies the Website panel to one product / package / category inside the
 * caller's transaction. `input` absent = nothing website-related changes,
 * except that a COMPONENT product is never shown.
 */
export async function applyWebsite(
  tx: Tx,
  kind: WebsiteKind,
  id: number,
  input: WebsiteInput | undefined,
  ctx: WebsiteContext
): Promise<void> {
  const before = await readStored(tx, kind, id);
  if (!before) throw new WebsiteInputError("Not found");
  const w = input ?? {};

  const show = ctx.notEligible ? false : w.showOnWebsite ?? before.showOnWebsite;
  // A COMPONENT product posted "on" is simply corrected: the form disables
  // the switch and says why.
  const websiteName = w.websiteName === undefined ? before.websiteName : w.websiteName || null;
  const displayName = websiteName || ctx.name;

  // Address.
  const published = before.slugPublishedAt != null && before.slug != null;
  let slug = before.slug;
  if (w.slug !== undefined && w.slug !== null && w.slug !== "") {
    if (!SLUG_PATTERN.test(w.slug)) {
      throw new WebsiteInputError("The address may use only a–z, 0–9 and single hyphens (e.g. eid-gift-hamper)");
    }
    if (w.slug !== before.slug && (await slugTaken(tx, kind, w.slug, id))) {
      throw new WebsiteInputError(`The address "${w.slug}" is already used by another ${kind === "category" ? "category" : "product or package"}`);
    }
    slug = w.slug;
  } else if (!published) {
    // Not yet published: follows the name.
    slug = await autoSlug(tx, kind, id, displayName, ctx.code);
  }
  let slugPublishedAt = before.slugPublishedAt;
  if (slug !== before.slug && published && before.slug) {
    // The old address keeps working as a permanent redirect.
    await tx.websiteSlugRedirect.deleteMany({ where: { space: space(kind), slug: before.slug } });
    await tx.websiteSlugRedirect.create({
      data: {
        space: space(kind),
        slug: before.slug,
        productId: kind === "product" ? id : null,
        packageId: kind === "package" ? id : null,
        categoryId: kind === "category" ? id : null,
      },
    });
    slugPublishedAt = null;
  }
  if (slug) {
    // Reclaiming one of this item's own old addresses: it stops being a redirect.
    await tx.websiteSlugRedirect.deleteMany({
      where: {
        space: space(kind),
        slug,
        ...(kind === "product" ? { productId: id } : kind === "package" ? { packageId: id } : { categoryId: id }),
      },
    });
  }
  if (show && ctx.isActive && slug && !slugPublishedAt) slugPublishedAt = new Date();

  const common = {
    showOnWebsite: show,
    websiteName,
    slug,
    slugPublishedAt,
    websiteDescription: w.websiteDescription === undefined ? before.websiteDescription : w.websiteDescription?.trim() || null,
    websiteFeatured: w.websiteFeatured ?? before.websiteFeatured,
    websiteSortOrder: w.websiteSortOrder ?? before.websiteSortOrder,
    seoTitle: w.seoTitle === undefined ? before.seoTitle : w.seoTitle || null,
    seoDescription: w.seoDescription === undefined ? before.seoDescription : w.seoDescription || null,
  };

  if (kind === "category") {
    await tx.category.update({ where: { id }, data: common });
  } else {
    const photos = w.photos ?? before.photos ?? [];
    if (w.photos) assertPhotos(photos, before.photos ?? []);
    const compareAtPrice =
      w.compareAtPrice === undefined ? (before.compareAtPrice == null ? null : Number(before.compareAtPrice)) : w.compareAtPrice;
    if (compareAtPrice != null && ctx.price != null && !(compareAtPrice > ctx.price)) {
      throw new WebsiteInputError(`The compare-at price (৳${compareAtPrice}) must be above the price (৳${ctx.price}) — or leave it empty`);
    }
    const item = {
      ...common,
      photos,
      // The ERP's own views keep using photo_url: always the main photo.
      photoUrl: photos[0] ?? null,
      compareAtPrice,
      websiteBadge: w.websiteBadge ?? before.websiteBadge ?? "NONE",
    };
    if (kind === "product") {
      await tx.product.update({ where: { id }, data: item });
    } else {
      let categoryIds = before.websiteCategoryIds ?? [];
      if (w.websiteCategoryIds) {
        categoryIds = [...new Set(w.websiteCategoryIds)].sort((a, b) => a - b);
        const found = await tx.category.count({ where: { id: { in: categoryIds } } });
        if (found !== categoryIds.length) throw new WebsiteInputError("A website category no longer exists");
        await tx.packageWebsiteCategory.deleteMany({ where: { packageId: id } });
        if (categoryIds.length) {
          await tx.packageWebsiteCategory.createMany({ data: categoryIds.map((categoryId) => ({ packageId: id, categoryId })) });
        }
      }
      // A shown package with no website category is still on the website
      // (its page, search, home) — just not listed under a category. The form
      // asks for one; it isn't forced, so an unrelated edit never blocks.
      await tx.package.update({
        where: { id },
        data: { ...item, websiteShowContents: w.websiteShowContents ?? before.websiteShowContents ?? true },
      });
    }
  }

  const after = await readStored(tx, kind, id);
  const b = snapshot(before);
  const a = snapshot(after!);
  if (ctx.created || JSON.stringify(b) !== JSON.stringify(a)) {
    await logAuditTx(tx, {
      userId: ctx.userId,
      action: "catalog.website",
      entity: ENTITY[kind],
      entityId: id,
      before: ctx.created ? undefined : b,
      after: a,
    });
  }
}

export { websiteValues, productWebsiteBlock } from "./catalog-website-values";
