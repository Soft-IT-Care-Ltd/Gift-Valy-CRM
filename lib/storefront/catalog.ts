import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { loadBomCatalog } from "@/lib/bom-db";
import {
  BomError,
  collectChoiceGroups,
  packageAvailability,
  packagePrice,
  packagePrintKitNeeds,
  productAvailability,
  productPrintKitNeeds,
  type BomCatalog,
} from "@/lib/bom";
import { ensureWebsiteSlugs } from "@/lib/catalog-website";
import { parseRichText, richTextPlain, SEO_DESCRIPTION_MAX } from "@/lib/catalog-website-shape";
import { uploadUrlPath } from "@/lib/file-storage";
import { slugify } from "./slug";
import type {
  WebBadge,
  WebCard,
  WebCategory,
  WebCategoryRef,
  WebChoiceGroup,
  WebContentsLine,
  WebImage,
  WebItem,
  WebStock,
} from "./types";

// ROUND3 W-3 — the ONE gate between the database and the public website.
// Every public page and endpoint reads through here, and nothing under
// app/(store) touches Prisma itself (tests/storefront-catalog checks both).
// Every query names the columns it takes (`select`, never `include`) and every
// function returns only the shapes in ./types.ts, so cost, avgCost, cost
// snapshots, stock numbers, SKUs / package codes, suppliers, staff and
// customers can't leak by accident. Stock leaves only as a word.
//
// On the website: a product that is SELLABLE, active, "Show on website" on,
// with an address; a package that is active, shown, with an address and a
// BOM that prices; a category that is shown with an address. Prices come
// from the same packagePrice() as the order form (R3-2).

/** A transaction or the app's client — tests pass a rolled-back transaction. */
export type Db = Prisma.TransactionClient;
const appDb = () => prisma as unknown as Db;

const PRODUCT_ON_WEBSITE = {
  showOnWebsite: true,
  isActive: true,
  productType: "SELLABLE",
  slug: { not: null },
} satisfies Prisma.ProductWhereInput;

const PACKAGE_ON_WEBSITE = {
  showOnWebsite: true,
  isActive: true,
  slug: { not: null },
} satisfies Prisma.PackageWhereInput;

const CATEGORY_ON_WEBSITE = {
  showOnWebsite: true,
  slug: { not: null },
} satisfies Prisma.CategoryWhereInput;

const SLUG = /^[a-z0-9-]{1,80}$/;

// ---------- shared pieces ----------

/** "/uploads/<base>.<ext>" → the public image; anything else → null (placeholder). */
function webImage(url: string | null | undefined, alt: string): WebImage | null {
  const m = /^\/uploads\/([A-Za-z0-9][A-Za-z0-9-]{0,127})\.(jpg|jpeg|png|webp)$/.exec(url ?? "");
  return m ? { path: `/img/${m[1]}`, alt } : null;
}

const badgeOf = (b: string): WebBadge => (b === "NEW" || b === "BEST_SELLER" || b === "LIMITED" ? b : null);
/** Availability → a word. null = no stock-tracked part (made per order) = in stock; a broken BOM = out of stock. */
function stockFrom(fn: () => number | null): WebStock {
  try {
    const n = fn();
    return n === null || n > 0 ? "IN_STOCK" : "OUT_OF_STOCK";
  } catch (e) {
    if (e instanceof BomError) return "OUT_OF_STOCK";
    throw e;
  }
}
const money = (d: Prisma.Decimal | number | null): number | null => (d == null ? null : Math.round(Number(d) * 100) / 100);

/**
 * The BOM catalog with stock net of what confirmed orders already hold, so
 * "In stock" means it can still be sold. Also gives any shown item without an
 * address its first one (lib/catalog-website.ts).
 */
async function sellableCatalog(db: Db): Promise<BomCatalog> {
  await ensureWebsiteSlugs(db);
  const [catalog, reserved] = await Promise.all([
    loadBomCatalog(db),
    db.product.findMany({ where: { reservedQty: { gt: 0 } }, select: { id: true, reservedQty: true } }),
  ]);
  for (const r of reserved) {
    const p = catalog.products.get(r.id);
    if (p) catalog.products.set(r.id, { ...p, stockQty: Math.max(0, p.stockQty - r.reservedQty) });
  }
  return catalog;
}

function tryBom<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch (e) {
    if (e instanceof BomError) return null;
    throw e;
  }
}

const CARD_PRODUCT = {
  id: true,
  name: true,
  websiteName: true,
  slug: true,
  sellingPrice: true,
  compareAtPrice: true,
  websiteBadge: true,
  photos: true,
} satisfies Prisma.ProductSelect;

const CARD_PACKAGE = {
  id: true,
  name: true,
  websiteName: true,
  slug: true,
  compareAtPrice: true,
  websiteBadge: true,
  photos: true,
} satisfies Prisma.PackageSelect;

type ProductCardRow = Prisma.ProductGetPayload<{ select: typeof CARD_PRODUCT }>;
type PackageCardRow = Prisma.PackageGetPayload<{ select: typeof CARD_PACKAGE }>;

function productCard(r: ProductCardRow, catalog: BomCatalog): WebCard {
  const name = r.websiteName || r.name;
  return {
    kind: "product",
    slug: r.slug!,
    name,
    price: money(r.sellingPrice)!,
    compareAtPrice: money(r.compareAtPrice),
    badge: badgeOf(r.websiteBadge),
    image: webImage(r.photos[0], name),
    stock: stockFrom(() => productAvailability(catalog, r.id)),
  };
}

/** null when the package's BOM doesn't price (broken by hand) — then it isn't shown. */
function packageCard(r: PackageCardRow, catalog: BomCatalog): WebCard | null {
  const price = tryBom(() => packagePrice(catalog, r.id));
  if (!price) return null;
  const name = r.websiteName || r.name;
  return {
    kind: "package",
    slug: r.slug!,
    name,
    price: price.unitPrice,
    compareAtPrice: money(r.compareAtPrice),
    badge: badgeOf(r.websiteBadge),
    image: webImage(r.photos[0], name),
    stock: stockFrom(() => packageAvailability(catalog, r.id)),
  };
}

const ORDER = [{ websiteSortOrder: "asc" as const }, { name: "asc" as const }, { id: "asc" as const }];

/** Products + packages, merged in display order (sort order, then name). */
async function cards(
  db: Db,
  productWhere: Prisma.ProductWhereInput,
  packageWhere: Prisma.PackageWhereInput,
  take: number
): Promise<WebCard[]> {
  const [catalog, products, packages] = await Promise.all([
    sellableCatalog(db),
    db.product.findMany({ where: { ...PRODUCT_ON_WEBSITE, ...productWhere }, orderBy: ORDER, take, select: { ...CARD_PRODUCT, websiteSortOrder: true } }),
    db.package.findMany({ where: { ...PACKAGE_ON_WEBSITE, ...packageWhere }, orderBy: ORDER, take, select: { ...CARD_PACKAGE, websiteSortOrder: true } }),
  ]);
  const rows: { sort: number; card: WebCard }[] = [
    ...products.map((p) => ({ sort: p.websiteSortOrder, card: productCard(p, catalog) })),
    ...packages.flatMap((p) => {
      const card = packageCard(p, catalog);
      return card ? [{ sort: p.websiteSortOrder, card }] : [];
    }),
  ];
  rows.sort((a, b) => a.sort - b.sort || a.card.name.localeCompare(b.card.name));
  return rows.slice(0, take).map((r) => r.card);
}

// ---------- public reads ----------

/** Shown categories, in display order. */
export async function listWebCategories(db: Db = appDb()): Promise<WebCategory[]> {
  await ensureWebsiteSlugs(db);
  const rows = await db.category.findMany({
    where: CATEGORY_ON_WEBSITE,
    orderBy: ORDER,
    select: {
      name: true,
      websiteName: true,
      slug: true,
      photoUrl: true,
      websiteDescription: true,
      websiteFeatured: true,
      seoTitle: true,
      seoDescription: true,
    },
  });
  return rows.map(categoryOut);
}

function categoryOut(c: {
  name: string;
  websiteName: string | null;
  slug: string | null;
  photoUrl: string | null;
  websiteDescription: string | null;
  websiteFeatured: boolean;
  seoTitle: string | null;
  seoDescription: string | null;
}): WebCategory {
  const name = c.websiteName || c.name;
  return {
    slug: c.slug!,
    name,
    description: parseRichText(c.websiteDescription),
    image: webImage(c.photoUrl, name),
    featured: c.websiteFeatured,
    seoTitle: c.seoTitle || name,
    seoDescription: c.seoDescription || richTextPlain(c.websiteDescription).slice(0, SEO_DESCRIPTION_MAX),
  };
}

/** Products and packages shown on the website (home: `featured`), display order. */
export async function listWebItems(opts: { featured?: boolean; take?: number } = {}, db: Db = appDb()): Promise<WebCard[]> {
  const featured = opts.featured ? { websiteFeatured: true } : {};
  return cards(db, featured, featured, Math.min(opts.take ?? 48, 200));
}

/** A category page: the category and everything shown in it. `redirectTo` for an old address. */
export async function getWebCategory(
  slug: string,
  db: Db = appDb()
): Promise<{ category: WebCategory; items: WebCard[] } | { redirectTo: string } | null> {
  if (!SLUG.test(slug)) return null;
  await ensureWebsiteSlugs(db);
  const row = await db.category.findFirst({
    where: { ...CATEGORY_ON_WEBSITE, slug },
    select: {
      id: true,
      name: true,
      websiteName: true,
      slug: true,
      photoUrl: true,
      websiteDescription: true,
      websiteFeatured: true,
      seoTitle: true,
      seoDescription: true,
    },
  });
  if (!row) {
    const moved = await db.websiteSlugRedirect.findUnique({
      where: { space_slug: { space: "CATEGORY", slug } },
      select: { category: { select: { slug: true, showOnWebsite: true } } },
    });
    const c = moved?.category;
    return c?.slug && c.showOnWebsite && c.slug !== slug ? { redirectTo: c.slug } : null;
  }
  const items = await cards(db, { categoryId: row.id }, { websiteCategories: { some: { categoryId: row.id } } }, 200);
  return { category: categoryOut(row), items };
}

/** Search by name in Bangla or English, the address, or the category name. */
export async function searchWebItems(q: string, db: Db = appDb()): Promise<WebCard[]> {
  const query = q.normalize("NFC").trim().slice(0, 80);
  if (query.length < 1) return [];
  const words = slugify(query).split("-").filter((w) => w.length >= 2);
  const bySlug = words.length ? [{ AND: words.map((w) => ({ slug: { contains: w } })) }] : [];
  const productWhere: Prisma.ProductWhereInput = {
    OR: [
      { name: { contains: query, mode: "insensitive" } },
      { websiteName: { contains: query, mode: "insensitive" } },
      { category: { showOnWebsite: true, OR: [{ name: { contains: query, mode: "insensitive" } }, { websiteName: { contains: query, mode: "insensitive" } }] } },
      ...bySlug,
    ],
  };
  const packageWhere: Prisma.PackageWhereInput = {
    OR: [
      { name: { contains: query, mode: "insensitive" } },
      { websiteName: { contains: query, mode: "insensitive" } },
      {
        websiteCategories: {
          some: { category: { showOnWebsite: true, OR: [{ name: { contains: query, mode: "insensitive" } }, { websiteName: { contains: query, mode: "insensitive" } }] } },
        },
      },
      ...bySlug,
    ],
  };
  return cards(db, productWhere, packageWhere, 60);
}

/** A product / package page. `redirectTo` when the address is an old one of a moved item. */
export async function getWebItem(slug: string, db: Db = appDb()): Promise<{ item: WebItem } | { redirectTo: string } | null> {
  if (!SLUG.test(slug)) return null;
  const catalog = await sellableCatalog(db);
  const detail = {
    websiteDescription: true,
    seoTitle: true,
    seoDescription: true,
  } as const;
  const [product, pkg] = await Promise.all([
    db.product.findFirst({
      where: { ...PRODUCT_ON_WEBSITE, slug },
      select: { ...CARD_PRODUCT, ...detail, category: { select: { name: true, websiteName: true, slug: true, showOnWebsite: true } } },
    }),
    db.package.findFirst({
      where: { ...PACKAGE_ON_WEBSITE, slug },
      select: {
        ...CARD_PACKAGE,
        ...detail,
        websiteShowContents: true,
        websiteCategories: {
          where: { category: CATEGORY_ON_WEBSITE },
          select: { category: { select: { name: true, websiteName: true, slug: true, websiteSortOrder: true } } },
        },
      },
    }),
  ]);

  if (product) {
    const card = productCard(product, catalog);
    const c = product.category;
    return {
      item: {
        ...card,
        description: parseRichText(product.websiteDescription),
        categories: c.showOnWebsite && c.slug ? [{ name: c.websiteName || c.name, slug: c.slug }] : [],
        photos: product.photos.flatMap((p) => webImage(p, card.name) ?? []),
        choiceGroups: [],
        contents: null,
        needsPhotos: (tryBom(() => productPrintKitNeeds(catalog, product.id)) ?? []).length > 0,
        seoTitle: product.seoTitle || card.name,
        seoDescription: product.seoDescription || richTextPlain(product.websiteDescription).slice(0, SEO_DESCRIPTION_MAX),
      },
    };
  }

  if (pkg) {
    const card = packageCard(pkg, catalog);
    if (!card) return null;
    const names = await itemNames(db, catalog);
    const categories: WebCategoryRef[] = [...pkg.websiteCategories]
      .sort((a, b) => a.category.websiteSortOrder - b.category.websiteSortOrder || a.category.name.localeCompare(b.category.name))
      .map(({ category: c }) => ({ name: c.websiteName || c.name, slug: c.slug! }));
    return {
      item: {
        ...card,
        description: parseRichText(pkg.websiteDescription),
        categories,
        photos: pkg.photos.flatMap((p) => webImage(p, card.name) ?? []),
        choiceGroups: choiceGroupsOf(catalog, pkg.id, names),
        contents: pkg.websiteShowContents ? contentsOf(catalog, pkg.id, names) : null,
        needsPhotos: (tryBom(() => packagePrintKitNeeds(catalog, pkg.id)) ?? []).length > 0,
        seoTitle: pkg.seoTitle || card.name,
        seoDescription: pkg.seoDescription || richTextPlain(pkg.websiteDescription).slice(0, SEO_DESCRIPTION_MAX),
      },
    };
  }

  const moved = await db.websiteSlugRedirect.findUnique({
    where: { space_slug: { space: "ITEM", slug } },
    select: {
      product: { select: { slug: true, showOnWebsite: true, isActive: true, productType: true } },
      package: { select: { slug: true, showOnWebsite: true, isActive: true } },
    },
  });
  const target = moved?.product?.productType === "SELLABLE" ? moved.product : moved?.package;
  if (target?.slug && target.showOnWebsite && target.isActive && target.slug !== slug) return { redirectTo: target.slug };
  return null;
}

/**
 * The file behind /img/<base>-<size>.webp — only a photo of something the
 * website shows: a shown product / package, a shown category, or a choice
 * option inside a shown package (its photo is on that package's page).
 * null = 404. `/uploads` itself stays behind the staff login.
 */
export async function publicPhotoFile(base: string, db: Db = appDb()): Promise<string | null> {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(base)) return null;
  const urls = ["jpg", "jpeg", "png", "webp"].map((ext) => `/uploads/${base}.${ext}`);
  await ensureWebsiteSlugs(db);
  const [product, pkg, category] = await Promise.all([
    db.product.findFirst({ where: { ...PRODUCT_ON_WEBSITE, photos: { hasSome: urls } }, select: { photos: true } }),
    db.package.findFirst({ where: { ...PACKAGE_ON_WEBSITE, photos: { hasSome: urls } }, select: { photos: true } }),
    db.category.findFirst({ where: { ...CATEGORY_ON_WEBSITE, photoUrl: { in: urls } }, select: { photoUrl: true } }),
  ]);
  const hit =
    product?.photos.find((p) => urls.includes(p)) ??
    pkg?.photos.find((p) => urls.includes(p)) ??
    (category?.photoUrl && urls.includes(category.photoUrl) ? category.photoUrl : undefined) ??
    (await optionPhoto(db, urls));
  return hit ? uploadUrlPath(hit) : null;
}

/** A choice option's main photo, when the option sits in a shown package's tree. */
async function optionPhoto(db: Db, urls: string[]): Promise<string | undefined> {
  const owners = await db.product.findMany({
    where: { isActive: true, photos: { hasSome: urls }, choiceOptions: { some: {} } },
    select: { id: true, photos: true },
  });
  // Only the main photo of an option is shown on a package page.
  const candidates = owners.filter((o) => urls.includes(o.photos[0] ?? ""));
  if (candidates.length === 0) return undefined;
  const [catalog, shown] = await Promise.all([
    loadBomCatalog(db),
    db.package.findMany({ where: PACKAGE_ON_WEBSITE, select: { id: true } }),
  ]);
  const optionIds = new Set<number>();
  for (const p of shown) {
    for (const g of tryBom(() => collectChoiceGroups(catalog, p.id)) ?? []) for (const o of g.options) optionIds.add(o.productId);
  }
  return candidates.find((c) => optionIds.has(c.id))?.photos[0];
}

// ---------- package detail helpers ----------

type Names = { products: Map<number, { name: string; photo: string | null }>; packages: Map<number, string> };

async function itemNames(db: Db, catalog: BomCatalog): Promise<Names> {
  const [products, packages] = await Promise.all([
    db.product.findMany({ where: { id: { in: [...catalog.products.keys()] } }, select: { id: true, name: true, websiteName: true, photos: true } }),
    db.package.findMany({ where: { id: { in: [...catalog.packages.keys()] } }, select: { id: true, name: true, websiteName: true } }),
  ]);
  return {
    products: new Map(products.map((p) => [p.id, { name: p.websiteName || p.name, photo: p.photos[0] ?? null }])),
    packages: new Map(packages.map((p) => [p.id, p.websiteName || p.name])),
  };
}

function choiceGroupsOf(catalog: BomCatalog, packageId: number, names: Names): WebChoiceGroup[] {
  const groups = tryBom(() => collectChoiceGroups(catalog, packageId)) ?? [];
  return groups.map((g) => ({
    key: g.groupId,
    label: g.label,
    qty: g.qty,
    path: g.path.map((pkgName) => pkgName),
    options: g.options.map((o) => {
      const p = names.products.get(o.productId);
      const name = p?.name ?? "Option";
      return {
        key: o.productId,
        name,
        extraPrice: Math.round(o.extraPrice * 100) / 100,
        isDefault: o.isDefault,
        stock: stockFrom(() => packageAvailability(catalog, packageId, new Map([[g.groupId, o.productId]]))),
        image: webImage(p?.photo, name),
      };
    }),
  }));
}

/** "What's inside": product lines, sub-packages (with their contents) and choices. Packing materials (COMPONENT products) are left out. */
function contentsOf(catalog: BomCatalog, packageId: number, names: Names, depth = 0): WebContentsLine[] {
  const pkg = catalog.packages.get(packageId);
  if (!pkg || depth > 5) return [];
  const out: WebContentsLine[] = [];
  for (const line of pkg.items) {
    if (line.kind === "PRODUCT" && line.productId != null) {
      if (catalog.products.get(line.productId)?.productType === "COMPONENT") continue;
      out.push({ name: names.products.get(line.productId)?.name ?? "Item", qty: line.qty, choice: false, children: [] });
    } else if (line.kind === "PACKAGE" && line.childPackageId != null) {
      out.push({
        name: names.packages.get(line.childPackageId) ?? "Set",
        qty: line.qty,
        choice: false,
        children: contentsOf(catalog, line.childPackageId, names, depth + 1),
      });
    } else if (line.kind === "CHOICE") {
      out.push({ name: line.choiceLabel || "Your choice", qty: line.qty, choice: true, children: [] });
    }
  }
  return out;
}
