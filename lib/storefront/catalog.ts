import type { Prisma } from "@prisma/client";
import { withdrawInactiveOptions } from "./inactive-options";
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
  type ChoiceGroupInfo,
  type PrintKitNeed,
} from "@/lib/bom";
import { printKitPhotoCount } from "@/lib/print-kit";
import { ensureWebsiteSlugs } from "@/lib/catalog-website";
import { parseRichText, richTextPlain, SEO_DESCRIPTION_MAX } from "@/lib/catalog-website-shape";
import { uploadUrlPath } from "@/lib/file-storage";
import {
  DEFAULT_HOME_LAYOUT,
  HOME_PAGE_ID,
  layoutBannerFiles,
  parseHomeLayout,
  type HomeLayout,
  type ItemRef,
} from "@/lib/home-page/layout";
import { slugify } from "./slug";
import { CATEGORY_ON_WEBSITE, PACKAGE_ON_WEBSITE, PRODUCT_ON_WEBSITE } from "./on-website";
import { normalizeWebSettings, WEBSITE_SETTINGS_KEY, type WebSettings } from "./settings-shape";
import type {
  WebBadge,
  WebCard,
  WebCategory,
  WebCategoryRef,
  WebChoiceGroup,
  WebContentsLine,
  WebCurrency,
  WebDelivery,
  WebImage,
  WebItem,
  WebStock,
  WebBagLine,
  WebBagLineIn,
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
  const [catalog, reserved, inactiveOptions] = await Promise.all([
    loadBomCatalog(db),
    db.product.findMany({ where: { reservedQty: { gt: 0 } }, select: { id: true, reservedQty: true } }),
    db.product.findMany({ where: { isActive: false, choiceOptions: { some: {} } }, select: { id: true } }),
  ]);
  for (const r of reserved) {
    const p = catalog.products.get(r.id);
    if (p) catalog.products.set(r.id, { ...p, stockQty: Math.max(0, p.stockQty - r.reservedQty) });
  }
  return withdrawInactiveOptions(catalog, inactiveOptions.map((p) => p.id));
}

/** Photos and cards a print kit asks the customer for — one item, these picks. */
function kitCounts(needs: PrintKitNeed[] | null): { photos: number; cards: number } {
  let photos = 0;
  let cards = 0;
  for (const n of needs ?? []) {
    photos += printKitPhotoCount(n.kit) * n.units;
    cards += n.kit.cards.length * n.units;
  }
  return { photos, cards };
}

/** Can this choice option itself be supplied for one package (qty pieces of it)? */
function optionStock(catalog: BomCatalog, productId: number, qty: number): WebStock {
  return stockFrom(() => {
    const n = productAvailability(catalog, productId);
    return n === null ? null : n >= qty ? 1 : 0;
  });
}

/**
 * The picks a visitor starts with: each group's default, or — when the
 * default itself is out — its first option in stock. A package is "In stock"
 * when it can be made with these (lib/storefront/picks.ts initialPicks()
 * makes the same choice in the browser).
 */
function bestPicks(catalog: BomCatalog, packageId: number): Map<number, number> {
  const picks = new Map<number, number>();
  for (const g of tryBom(() => collectChoiceGroups(catalog, packageId)) ?? []) {
    const def = g.options.find((o) => o.isDefault) ?? g.options[0];
    if (!def) continue;
    const pick =
      optionStock(catalog, def.productId, g.qty) === "IN_STOCK"
        ? def
        : (g.options.find((o) => optionStock(catalog, o.productId, g.qty) === "IN_STOCK") ?? def);
    picks.set(g.groupId, pick.productId);
  }
  return picks;
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
    printPhotos: kitCounts(tryBom(() => productPrintKitNeeds(catalog, r.id))).photos,
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
    stock: stockFrom(() => packageAvailability(catalog, r.id, bestPicks(catalog, r.id))),
    printPhotos: kitCounts(tryBom(() => packagePrintKitNeeds(catalog, r.id))).photos,
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

/** Shown categories that have something on the website (a category of packing materials stays out of the menu), in display order. */
export async function listWebCategories(db: Db = appDb()): Promise<WebCategory[]> {
  await ensureWebsiteSlugs(db);
  const rows = await db.category.findMany({
    where: {
      ...CATEGORY_ON_WEBSITE,
      OR: [{ products: { some: PRODUCT_ON_WEBSITE } }, { websitePackages: { some: { package: PACKAGE_ON_WEBSITE } } }],
    },
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
    deliveryChargeInsideDhaka: true,
    deliveryChargeSubDhaka: true,
    deliveryChargeOutsideDhaka: true,
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
        printCards: kitCounts(tryBom(() => productPrintKitNeeds(catalog, product.id))).cards,
        delivery: deliveryOf(product),
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
        choiceGroups: choiceGroupsOf(catalog, pkg.id, names, card.price),
        contents: pkg.websiteShowContents ? contentsOf(catalog, pkg.id, names) : null,
        printCards: kitCounts(tryBom(() => packagePrintKitNeeds(catalog, pkg.id))).cards,
        delivery: deliveryOf(pkg),
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

/** ROUND3 W-4 — "More like this": shown items sharing a category with the item (else the featured ones). */
export async function relatedWebItems(slug: string, take = 8, db: Db = appDb()): Promise<WebCard[]> {
  if (!SLUG.test(slug)) return [];
  const limit = Math.min(Math.max(1, take), 24);
  const [product, pkg] = await Promise.all([
    db.product.findFirst({ where: { ...PRODUCT_ON_WEBSITE, slug }, select: { categoryId: true, category: { select: { showOnWebsite: true } } } }),
    db.package.findFirst({
      where: { ...PACKAGE_ON_WEBSITE, slug },
      select: { websiteCategories: { where: { category: CATEGORY_ON_WEBSITE }, select: { categoryId: true } } },
    }),
  ]);
  const categoryIds = product
    ? product.category.showOnWebsite
      ? [product.categoryId]
      : []
    : (pkg?.websiteCategories.map((c) => c.categoryId) ?? []);
  if (!product && !pkg) return [];
  const notSelf = { slug: { not: slug } };
  const related = categoryIds.length
    ? await cards(
        db,
        { ...notSelf, categoryId: { in: categoryIds } },
        { ...notSelf, websiteCategories: { some: { categoryId: { in: categoryIds } } } },
        limit
      )
    : [];
  if (related.length > 0) return related;
  return cards(db, { ...notSelf, websiteFeatured: true }, { ...notSelf, websiteFeatured: true }, limit);
}

const DELIVERY_SELECT = {
  deliveryChargeInsideDhaka: true,
  deliveryChargeSubDhaka: true,
  deliveryChargeOutsideDhaka: true,
} as const;

/**
 * ROUND3 W-5 — the bag and the checkout, re-read: each saved line as it is now
 * (name, photo, today's price for its picks, stock as a word, delivery charge
 * per zone, print-kit counts). null = no longer on the website. A saved pick
 * that is no longer an option falls back to the group's default and says so.
 * Prices come from packagePrice() — exactly how the order endpoint prices.
 */
export async function webBagLines(lines: WebBagLineIn[], db: Db = appDb()): Promise<(WebBagLine | null)[]> {
  const wanted = lines.slice(0, 50).filter((l) => (l.kind === "product" || l.kind === "package") && SLUG.test(l.slug));
  if (wanted.length === 0) return lines.map(() => null);
  const productSlugs = wanted.filter((l) => l.kind === "product").map((l) => l.slug);
  const packageSlugs = wanted.filter((l) => l.kind === "package").map((l) => l.slug);
  const [catalog, products, packages] = await Promise.all([
    sellableCatalog(db),
    productSlugs.length
      ? db.product.findMany({ where: { ...PRODUCT_ON_WEBSITE, slug: { in: productSlugs } }, select: { ...CARD_PRODUCT, ...DELIVERY_SELECT } })
      : [],
    packageSlugs.length
      ? db.package.findMany({ where: { ...PACKAGE_ON_WEBSITE, slug: { in: packageSlugs } }, select: { ...CARD_PACKAGE, ...DELIVERY_SELECT } })
      : [],
  ]);
  const productBySlug = new Map(products.map((p) => [p.slug!, p]));
  const packageBySlug = new Map(packages.map((p) => [p.slug!, p]));
  const names = packages.length ? await itemNames(db, catalog) : null;

  return lines.map((line): WebBagLine | null => {
    if (!wanted.includes(line)) return null;
    if (line.kind === "product") {
      const p = productBySlug.get(line.slug);
      if (!p) return null;
      const card = productCard(p, catalog);
      const kit = kitCounts(tryBom(() => productPrintKitNeeds(catalog, p.id)));
      return {
        kind: "product",
        slug: card.slug,
        name: card.name,
        image: card.image,
        picks: {},
        choices: [],
        choicesChanged: false,
        price: card.price,
        stock: card.stock,
        delivery: deliveryOf(p),
        printPhotos: kit.photos,
        printCards: kit.cards,
      };
    }
    const pkg = packageBySlug.get(line.slug);
    if (!pkg) return null;
    const groups = tryBom(() => collectChoiceGroups(catalog, pkg.id));
    if (!groups) return null;
    let changed = Object.keys(line.picks ?? {}).some((k) => !groups.some((g) => String(g.groupId) === k));
    const picks = new Map<number, number>();
    for (const g of groups) {
      const saved = line.picks?.[String(g.groupId)];
      const option = g.options.find((o) => o.productId === saved);
      if (saved !== undefined && !option) changed = true;
      const pick = option ?? g.options.find((o) => o.isDefault) ?? g.options[0];
      if (pick) picks.set(g.groupId, pick.productId);
    }
    const price = tryBom(() => packagePrice(catalog, pkg.id, picks));
    if (!price) return null;
    const name = pkg.websiteName || pkg.name;
    const kit = kitCounts(tryBom(() => packagePrintKitNeeds(catalog, pkg.id, picks)));
    return {
      kind: "package",
      slug: pkg.slug!,
      name,
      image: webImage(pkg.photos[0], name),
      picks: Object.fromEntries([...picks].map(([g, o]) => [String(g), o])),
      choices: groups.map((g) => ({ label: g.label, name: names?.products.get(picks.get(g.groupId)!)?.name ?? "Option" })),
      choicesChanged: changed,
      price: price.unitPrice,
      stock: stockFrom(() => packageAvailability(catalog, pkg.id, picks)),
      delivery: deliveryOf(pkg),
      printPhotos: kit.photos,
      printCards: kit.cards,
    };
  });
}

/**
 * ROUND3 W-4 — what the website needs from Settings → Website (W-7 adds the
 * editor): the WhatsApp number and Messenger page for the order buttons,
 * contact details, delivery times, the policy texts. Unset = empty: no button.
 */
export async function getWebSettings(db: Db = appDb()): Promise<WebSettings> {
  const row = await db.setting.findUnique({ where: { key: WEBSITE_SETTINGS_KEY }, select: { value: true } });
  return normalizeWebSettings(row?.value ?? null);
}

/**
 * ROUND3 W-8 — the Meta Pixel the website loads, or null: tracking switched
 * on with a Pixel ID and a token (lib/meta/config.ts). A Pixel ID is public;
 * the token column is never selected here.
 */
export async function getWebPixelId(db: Db = appDb()): Promise<string | null> {
  const row = await db.metaTracking.findFirst({
    where: { id: "meta", isEnabled: true, pixelId: { not: null }, accessTokenEncrypted: { not: null } },
    select: { pixelId: true },
  });
  return row?.pixelId ?? null;
}

/**
 * ROUND3 W-8 — sitemap.xml: the address of every category, product and
 * package the website shows, with when the item last changed. Nothing else.
 */
export async function listWebAddresses(db: Db = appDb()): Promise<{ categories: string[]; items: { slug: string; lastmod: string }[] }> {
  const [catalog, categories, products, packages] = await Promise.all([
    sellableCatalog(db),
    listWebCategories(db),
    db.product.findMany({ where: PRODUCT_ON_WEBSITE, orderBy: ORDER, select: { slug: true, updatedAt: true } }),
    db.package.findMany({ where: PACKAGE_ON_WEBSITE, orderBy: ORDER, select: { id: true, slug: true, updatedAt: true } }),
  ]);
  const priced = packages.filter((p) => tryBom(() => packagePrice(catalog, p.id)) !== null);
  return {
    categories: categories.map((c) => c.slug),
    items: [...products, ...priced].map((r) => ({ slug: r.slug!, lastmod: r.updatedAt.toISOString().slice(0, 10) })),
  };
}

// ---------- ROUND3 W-7 — the home page ----------

/**
 * The home page's sections: what the website shows ("published") or the home
 * page manager's draft ("draft", for the signed preview only). Never
 * published yet = the starting layout (the W-4 home page).
 */
export async function getHomeLayout(which: "published" | "draft", db: Db = appDb()): Promise<HomeLayout> {
  const row = await db.homePage.findUnique({ where: { id: HOME_PAGE_ID }, select: { draft: true, published: true } });
  const published = parseHomeLayout(row?.published);
  if (which === "published") return published ?? DEFAULT_HOME_LAYOUT;
  return parseHomeLayout(row?.draft) ?? published ?? DEFAULT_HOME_LAYOUT;
}

/** Hand-picked products / packages, in the order chosen — only what is on the website (a hidden one simply drops out). */
export async function webItemsByRefs(refs: ItemRef[], db: Db = appDb()): Promise<WebCard[]> {
  if (refs.length === 0) return [];
  const productIds = refs.filter((r) => r.kind === "product").map((r) => r.id);
  const packageIds = refs.filter((r) => r.kind === "package").map((r) => r.id);
  const [catalog, products, packages] = await Promise.all([
    sellableCatalog(db),
    productIds.length ? db.product.findMany({ where: { ...PRODUCT_ON_WEBSITE, id: { in: productIds } }, select: CARD_PRODUCT }) : [],
    packageIds.length ? db.package.findMany({ where: { ...PACKAGE_ON_WEBSITE, id: { in: packageIds } }, select: CARD_PACKAGE }) : [],
  ]);
  const byKey = new Map<string, WebCard>();
  for (const p of products) byKey.set(`product:${p.id}`, productCard(p, catalog));
  for (const p of packages) {
    const card = packageCard(p, catalog);
    if (card) byKey.set(`package:${p.id}`, card);
  }
  const seen = new Set<string>();
  const out: WebCard[] = [];
  for (const r of refs) {
    const key = `${r.kind}:${r.id}`;
    const card = byKey.get(key);
    if (card && !seen.has(key)) {
      seen.add(key);
      out.push(card);
    }
  }
  return out;
}

const CATEGORY_TILE = {
  id: true,
  name: true,
  websiteName: true,
  slug: true,
  photoUrl: true,
  websiteDescription: true,
  websiteFeatured: true,
  seoTitle: true,
  seoDescription: true,
} satisfies Prisma.CategorySelect;

/** Hand-picked category tiles, in the order chosen — only shown categories with something on the website. */
export async function webCategoriesByIds(ids: number[], db: Db = appDb()): Promise<WebCategory[]> {
  if (ids.length === 0) return [];
  await ensureWebsiteSlugs(db);
  const rows = await db.category.findMany({
    where: {
      ...CATEGORY_ON_WEBSITE,
      id: { in: ids },
      OR: [{ products: { some: PRODUCT_ON_WEBSITE } }, { websitePackages: { some: { package: PACKAGE_ON_WEBSITE } } }],
    },
    select: CATEGORY_TILE,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return [...new Set(ids)].flatMap((id) => {
    const r = byId.get(id);
    return r ? [categoryOut(r)] : [];
  });
}

/** A home section "from one category": its first items and its address; null when the category isn't on the website. */
export async function webCategoryCards(
  categoryId: number,
  take: number,
  db: Db = appDb()
): Promise<{ slug: string; name: string; items: WebCard[] } | null> {
  await ensureWebsiteSlugs(db);
  const row = await db.category.findFirst({ where: { ...CATEGORY_ON_WEBSITE, id: categoryId }, select: CATEGORY_TILE });
  if (!row) return null;
  const items = await cards(db, { categoryId: row.id }, { websiteCategories: { some: { categoryId: row.id } } }, Math.min(take, 24));
  const c = categoryOut(row);
  return { slug: c.slug, name: c.name, items };
}

// The ISO currency code is public; it's the one `code` this module selects.
const CURRENCY_SELECT = { code: true, name: true, symbol: true, bdtPerUnit: true } satisfies Prisma.CurrencyRateSelect;

/** ROUND3 W-4 — active currency rates for the optional "≈ SAR 120 (approx.)" line (off unless Settings → Website says so). */
export async function listWebCurrencies(db: Db = appDb()): Promise<WebCurrency[]> {
  const rows = await db.currencyRate.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: CURRENCY_SELECT });
  return rows
    .map((r) => ({ iso: r.code, label: r.name, symbol: r.symbol || null, takaPerUnit: Number(r.bdtPerUnit) }))
    .filter((r) => Number.isFinite(r.takaPerUnit) && r.takaPerUnit > 0);
}

/**
 * The file behind /img/<base>-<size>.webp — only a photo of something the
 * website shows: a shown product / package, a shown category, or a choice
 * option inside a shown package (its photo is on that package's page).
 * null = 404. `/uploads` itself stays behind the staff login.
 */
export async function publicPhotoFile(base: string, db: Db = appDb()): Promise<string | null> {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(base)) return null;
  // W-7 — a home page banner: only while the published page or the draft (its signed preview) uses it.
  if (/^banner-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(base)) {
    const row = await db.homePage.findUnique({ where: { id: HOME_PAGE_ID }, select: { draft: true, published: true } });
    const used = [parseHomeLayout(row?.draft), parseHomeLayout(row?.published)].some((l) => l !== null && layoutBannerFiles(l).includes(`${base}.webp`));
    return used ? uploadUrlPath(`/uploads/${base}.webp`) : null;
  }
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
    db.product.findMany({ where: { id: { in: [...catalog.products.keys()] } }, select: { id: true, name: true, websiteName: true, photos: true, isActive: true } }),
    db.package.findMany({ where: { id: { in: [...catalog.packages.keys()] } }, select: { id: true, name: true, websiteName: true } }),
  ]);
  return {
    // An inactive product's photo is never served (/img), so it gets the placeholder.
    products: new Map(products.map((p) => [p.id, { name: p.websiteName || p.name, photo: p.isActive ? (p.photos[0] ?? null) : null }])),
    packages: new Map(packages.map((p) => [p.id, p.websiteName || p.name])),
  };
}

/**
 * The choice groups with, per option, how far it moves the price from the
 * default picks — worked out by packagePrice() itself (R3-2's one price
 * function), never re-derived: the page's live total is price + Σ deltas.
 */
function choiceGroupsOf(catalog: BomCatalog, packageId: number, names: Names, defaultPrice: number): WebChoiceGroup[] {
  // One sub-package used at two places in the tree lists its group twice, but
  // one pick (keyed by the group) serves both: show it once, its pieces added
  // up — else the page's live total would count each option's delta twice.
  const merged = new Map<number, ChoiceGroupInfo>();
  for (const g of tryBom(() => collectChoiceGroups(catalog, packageId)) ?? []) {
    const seen = merged.get(g.groupId);
    if (seen) merged.set(g.groupId, { ...seen, qty: seen.qty + g.qty });
    else merged.set(g.groupId, g);
  }
  const groups = [...merged.values()];
  const base = kitCounts(tryBom(() => packagePrintKitNeeds(catalog, packageId)));
  return groups.map((g) => ({
    key: g.groupId,
    label: g.label,
    qty: g.qty,
    // Website names: a sub-package's ERP name may carry internal codes.
    path: g.pathIds.map((id, i) => names.packages.get(id) ?? g.path[i]),
    options: g.options.map((o) => {
      const p = names.products.get(o.productId);
      const name = p?.name ?? "Option";
      const pick = new Map([[g.groupId, o.productId]]);
      const priced = tryBom(() => packagePrice(catalog, packageId, pick));
      const kit = kitCounts(tryBom(() => packagePrintKitNeeds(catalog, packageId, pick)));
      return {
        key: o.productId,
        name,
        extraPrice: Math.round(o.extraPrice * 100) / 100,
        isDefault: o.isDefault,
        priceDelta: priced ? Math.round((priced.unitPrice - defaultPrice) * 100) / 100 : 0,
        // The option on its own; the rest of the package is the item's stock (picks.ts liveStock).
        stock: priced ? optionStock(catalog, o.productId, g.qty) : "OUT_OF_STOCK",
        image: webImage(p?.photo, name),
        printPhotosDelta: kit.photos - base.photos,
        printCardsDelta: kit.cards - base.cards,
      };
    }),
  }));
}

const deliveryOf = (r: {
  deliveryChargeInsideDhaka: Prisma.Decimal;
  deliveryChargeSubDhaka: Prisma.Decimal;
  deliveryChargeOutsideDhaka: Prisma.Decimal;
}): WebDelivery => ({
  insideDhaka: money(r.deliveryChargeInsideDhaka)!,
  subDhaka: money(r.deliveryChargeSubDhaka)!,
  outsideDhaka: money(r.deliveryChargeOutsideDhaka)!,
});

/** "What's inside": product lines, sub-packages (with their contents) and choices. Packing materials (COMPONENT products) are left out. */
function contentsOf(catalog: BomCatalog, packageId: number, names: Names, depth = 0): WebContentsLine[] {
  const pkg = catalog.packages.get(packageId);
  if (!pkg || depth > 5) return [];
  const out: WebContentsLine[] = [];
  for (const line of pkg.items) {
    if (line.kind === "PRODUCT" && line.productId != null) {
      if (catalog.products.get(line.productId)?.productType === "COMPONENT") continue;
      out.push({ name: names.products.get(line.productId)?.name ?? "Item", qty: line.qty, choice: false, groupKey: null, children: [] });
    } else if (line.kind === "PACKAGE" && line.childPackageId != null) {
      out.push({
        name: names.packages.get(line.childPackageId) ?? "Set",
        qty: line.qty,
        choice: false,
        groupKey: null,
        children: contentsOf(catalog, line.childPackageId, names, depth + 1),
      });
    } else if (line.kind === "CHOICE") {
      out.push({ name: line.choiceLabel || "Your choice", qty: line.qty, choice: true, groupKey: line.id, children: [] });
    }
  }
  return out;
}
