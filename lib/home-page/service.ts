import { existsSync } from "node:fs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logAuditTx } from "@/lib/audit";
import { AuthzError } from "@/lib/authz";
import { uploadPath } from "@/lib/file-storage";
import {
  CATEGORY_ON_WEBSITE,
  PACKAGE_ON_WEBSITE,
  PRODUCT_ON_WEBSITE,
} from "@/lib/storefront/on-website";
import {
  DEFAULT_HOME_LAYOUT,
  HOME_PAGE_ID,
  homeLayoutSchema,
  layoutBannerFiles,
  layoutCategoryIds,
  layoutItemRefs,
  parseHomeLayout,
  type HomeLayout,
} from "./layout";

// ROUND3 W-7 — the home page manager (website.home: Admin, Manager). The
// owner edits a DRAFT; "Preview" opens it on the real website (a signed
// link, ./preview-token.ts); "Publish" makes it what every visitor sees —
// audited before/after, and the route clears the home page's cache
// (revalidateStorefrontHome) so the very next page load shows it. "Discard
// changes" puts the draft back to what is published.

type Db = Prisma.TransactionClient | typeof prisma;

export type PickItem = {
  kind: "product" | "package";
  id: number;
  name: string;
  photo: string | null;
  shown: boolean;
};
export type PickCategory = { id: number; name: string; shown: boolean };

export type HomeEditorState = {
  draft: HomeLayout;
  publishedAt: string | null;
  draftSavedAt: string | null;
  /** The draft differs from what the website shows. */
  unpublished: boolean;
  /** What the pickers offer: everything shown on the website, plus anything the draft names that no longer is. */
  items: PickItem[];
  categories: PickCategory[];
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export async function getHomeEditorState(
  db: Db = prisma,
): Promise<HomeEditorState> {
  const row = await db.homePage.findUnique({ where: { id: HOME_PAGE_ID } });
  const published = parseHomeLayout(row?.published);
  const draft = parseHomeLayout(row?.draft) ?? published ?? DEFAULT_HOME_LAYOUT;
  const refs = layoutItemRefs(draft);
  const namedProducts = refs
    .filter((r) => r.kind === "product")
    .map((r) => r.id);
  const namedPackages = refs
    .filter((r) => r.kind === "package")
    .map((r) => r.id);
  const namedCategories = layoutCategoryIds(draft);
  const [products, packages, categories] = await Promise.all([
    db.product.findMany({
      where: { OR: [PRODUCT_ON_WEBSITE, { id: { in: namedProducts } }] },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        websiteName: true,
        photos: true,
        showOnWebsite: true,
        isActive: true,
        productType: true,
        slug: true,
      },
    }),
    db.package.findMany({
      where: { OR: [PACKAGE_ON_WEBSITE, { id: { in: namedPackages } }] },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        websiteName: true,
        photos: true,
        showOnWebsite: true,
        isActive: true,
        slug: true,
      },
    }),
    db.category.findMany({
      where: { OR: [CATEGORY_ON_WEBSITE, { id: { in: namedCategories } }] },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        websiteName: true,
        showOnWebsite: true,
        slug: true,
      },
    }),
  ]);
  return {
    draft,
    publishedAt: row?.publishedAt?.toISOString() ?? null,
    draftSavedAt: row?.draftSavedAt.toISOString() ?? null,
    unpublished: !row?.published || !same(draft, published),
    items: [
      ...packages.map((p) => ({
        kind: "package" as const,
        id: p.id,
        name: p.websiteName || p.name,
        photo: p.photos[0] ?? null,
        shown: p.showOnWebsite && p.isActive && !!p.slug,
      })),
      ...products.map((p) => ({
        kind: "product" as const,
        id: p.id,
        name: p.websiteName || p.name,
        photo: p.photos[0] ?? null,
        shown:
          p.showOnWebsite &&
          p.isActive &&
          p.productType === "SELLABLE" &&
          !!p.slug,
      })),
    ],
    categories: categories.map((c) => ({
      id: c.id,
      name: c.websiteName || c.name,
      shown: c.showOnWebsite && !!c.slug,
    })),
  };
}

/** Every photo, item and category the layout names must exist (a hidden one is fine: it simply doesn't show). */
async function checkReferences(db: Db, layout: HomeLayout): Promise<void> {
  for (const file of layoutBannerFiles(layout)) {
    const onDisk = uploadPath(file);
    if (!onDisk || !existsSync(onDisk))
      throw new AuthzError(400, "A banner photo is missing — upload it again");
  }
  const refs = layoutItemRefs(layout);
  const productIds = [
    ...new Set(refs.filter((r) => r.kind === "product").map((r) => r.id)),
  ];
  const packageIds = [
    ...new Set(refs.filter((r) => r.kind === "package").map((r) => r.id)),
  ];
  const categoryIds = layoutCategoryIds(layout);
  const [products, packages, categories] = await Promise.all([
    productIds.length
      ? db.product.count({ where: { id: { in: productIds } } })
      : 0,
    packageIds.length
      ? db.package.count({ where: { id: { in: packageIds } } })
      : 0,
    categoryIds.length
      ? db.category.count({ where: { id: { in: categoryIds } } })
      : 0,
  ]);
  if (products !== productIds.length || packages !== packageIds.length)
    throw new AuthzError(
      400,
      "A chosen product or package is no longer in the catalog — remove it",
    );
  if (categories !== categoryIds.length)
    throw new AuthzError(400, "A chosen category no longer exists — remove it");
}

export function parseLayoutOrThrow(raw: unknown): HomeLayout {
  const parsed = homeLayoutSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AuthzError(400, issue?.message ?? "The layout isn't valid");
  }
  return parsed.data;
}

export async function saveHomeDraft(
  raw: unknown,
  userId: number,
  db: Db = prisma,
): Promise<HomeEditorState> {
  const layout = parseLayoutOrThrow(raw);
  await checkReferences(db, layout);
  const now = new Date();
  const draft = layout as unknown as Prisma.InputJsonValue;
  await db.homePage.upsert({
    where: { id: HOME_PAGE_ID },
    create: {
      id: HOME_PAGE_ID,
      draft,
      draftSavedAt: now,
      draftSavedBy: userId,
    },
    update: { draft, draftSavedAt: now, draftSavedBy: userId },
  });
  return getHomeEditorState(db);
}

/** The saved draft becomes the website's home page. The caller clears the cache after the commit. */
export async function publishHomePage(
  userId: number,
  db: typeof prisma = prisma,
): Promise<HomeEditorState> {
  await db.$transaction((tx) => publishHomePageTx(tx, userId));
  return getHomeEditorState(db);
}

/** The publish inside the caller's transaction (the tests run it rolled back). */
export async function publishHomePageTx(
  tx: Prisma.TransactionClient,
  userId: number,
): Promise<void> {
  const row = await tx.homePage.findUnique({ where: { id: HOME_PAGE_ID } });
  const draft =
    parseHomeLayout(row?.draft) ??
    parseHomeLayout(row?.published) ??
    DEFAULT_HOME_LAYOUT;
  await checkReferences(tx, draft);
  const now = new Date();
  const value = draft as unknown as Prisma.InputJsonValue;
  await tx.homePage.upsert({
    where: { id: HOME_PAGE_ID },
    create: {
      id: HOME_PAGE_ID,
      draft: value,
      published: value,
      publishedAt: now,
      publishedBy: userId,
      draftSavedAt: now,
      draftSavedBy: userId,
    },
    update: { published: value, publishedAt: now, publishedBy: userId },
  });
  await logAuditTx(tx, {
    userId,
    action: "website.home.publish",
    entity: "home_page",
    entityId: HOME_PAGE_ID,
    before: row?.published ?? null,
    after: draft,
  });
}

/** Throw the draft away: back to what the website shows. */
export async function discardHomeDraft(
  userId: number,
  db: Db = prisma,
): Promise<HomeEditorState> {
  const row = await db.homePage.findUnique({ where: { id: HOME_PAGE_ID } });
  const published = (parseHomeLayout(row?.published) ??
    DEFAULT_HOME_LAYOUT) as unknown as Prisma.InputJsonValue;
  await db.homePage.upsert({
    where: { id: HOME_PAGE_ID },
    create: { id: HOME_PAGE_ID, draft: published, draftSavedBy: userId },
    update: {
      draft: published,
      draftSavedAt: new Date(),
      draftSavedBy: userId,
    },
  });
  return getHomeEditorState(db);
}
