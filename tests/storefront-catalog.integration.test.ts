// ROUND3 W-2 + W-3 — the Website panel's server path (lib/catalog-website.ts)
// and the one public catalog gate (lib/storefront/catalog.ts), against the dev
// database. Every test runs inside ONE transaction that is rolled back, so
// the catalog is left untouched and no order is ever made (CLAUDE.md rule 6).
// Run: npm run test:storefront-catalog (needs DATABASE_URL).
//
// The leak scan: the fixture carries sentinel values — an SKU, a package
// code, avg cost, a purchase unit cost and supplier, stock and reserved
// numbers, a price floor, the staff member who created it and a customer's
// phone. Every public read is called and its whole output walked: no key may
// look like cost / stock / SKU / staff / customer data, and no sentinel value
// may appear anywhere. A function added to the catalog module without being
// added here fails the test.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { prisma as appPrisma } from "../lib/db";
import * as catalog from "../lib/storefront/catalog";
import { buildHomeView } from "../lib/storefront/home-data";
import { applyWebsite, WebsiteInputError } from "../lib/catalog-website";
import { parseRichText } from "../lib/catalog-website-shape";
import { uploadUrlPath } from "../lib/file-storage";

const ROOT = path.resolve(__dirname, "..");
const prisma = new PrismaClient();
const ROLLBACK = new Error("rollback");
after(async () => {
  await prisma.$disconnect();
  await appPrisma.$disconnect();
});

type Tx = Prisma.TransactionClient;

async function inRollback(fn: (tx: Tx) => Promise<void>) {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        await fn(tx);
        throw ROLLBACK;
      },
      { timeout: 180_000, maxWait: 20_000 }
    ),
    (e) => {
      if (e === ROLLBACK) return true;
      throw e;
    }
  );
}

// ---------- the scan ----------

const FORBIDDEN_KEY = /cost|avg|sku|^code$|stock_?qty|reserved|available|supplier|purchase|phone|customer|created|updated|margin|profit|floor|snapshot|weight|email|user|staff|^id$/i;

function scan(label: string, value: unknown, sentinels: { strings: string[]; numbers: number[] }) {
  const problems: string[] = [];
  const walk = (v: unknown, at: string) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${at}[${i}]`));
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (FORBIDDEN_KEY.test(k)) problems.push(`${at}.${k}: forbidden key`);
        walk(x, `${at}.${k}`);
      }
      return;
    }
    if (typeof v === "number" && sentinels.numbers.includes(v)) problems.push(`${at}: sentinel number ${v}`);
    if (typeof v === "string") {
      for (const s of sentinels.strings) if (v.toLowerCase().includes(s.toLowerCase())) problems.push(`${at}: contains "${s}"`);
    }
  };
  walk(value, label);
  assert.deepEqual(problems, [], `${label} leaks`);
}

// Every export of lib/storefront/catalog.ts and how the test calls it.
const SCANNED = [
  "listWebCategories",
  "listWebItems",
  "getWebCategory",
  "searchWebItems",
  "getWebItem",
  "relatedWebItems", // W-4
  "getWebSettings", // W-4 — Settings → Website, read by the pages
  "listWebCurrencies", // W-4 — the optional approx. price
  "publicPhotoFile", // returns a server file path, never sent; checked separately
  "webBagLines", // W-5 — the bag and checkout, re-read
  "getWebPixelId", // W-8 — the Meta Pixel ID (public), never the token
  "listWebAddresses", // W-8 — sitemap.xml
  "getHomeLayout", // W-7 — the layout (with catalog ids) never leaves the server: buildHomeView turns it into public blocks, scanned
  "webItemsByRefs", // W-7 — hand-picked home page items
  "webCategoriesByIds", // W-7 — hand-picked category tiles
  "webCategoryCards", // W-7 — a home section from one category
];

// ---------- fixture ----------

async function fixture(tx: Tx) {
  const tag = randomUUID().slice(0, 8);
  const role = await tx.role.findFirstOrThrow({ select: { id: true } });
  const staff = await tx.user.create({
    data: {
      name: `Staffname${tag}`,
      email: `leak-${tag}@example.test`,
      phone: `01799${tag.replace(/\D/g, "0").slice(0, 6).padEnd(6, "7")}`,
      passwordHash: "x",
      roleId: role.id,
    },
  });
  const customer = await tx.customer.create({
    data: { name: `Customername${tag}`, phoneForeign: `+96655${tag.replace(/\D/g, "1").slice(0, 7).padEnd(7, "3")}`, country: "KSA" },
  });
  const category = await tx.category.create({ data: { name: `Leaktest Cat ${tag}`, createdBy: staff.id } });
  await applyWebsite(tx, "category", category.id, { showOnWebsite: true, websiteFeatured: true }, {
    userId: staff.id, name: category.name, code: null, price: null, notEligible: null, isActive: true, created: true,
  });

  const photo = `/uploads/${randomUUID()}.jpg`;
  const optionPhoto = `/uploads/${randomUUID()}.jpg`;
  const hiddenPhoto = `/uploads/${randomUUID()}.jpg`;
  const mk = (data: Partial<Prisma.ProductUncheckedCreateInput> & { name: string; sku: string }) =>
    tx.product.create({
      data: {
        categoryId: category.id,
        sellingPrice: 0,
        createdBy: staff.id,
        updatedBy: staff.id,
        showOnWebsite: false,
        ...data,
      },
    });

  // Bangla name → a Latin address.
  const choc = await mk({
    name: "লিকটেস্ট চকলেট",
    sku: `LEAKSKU-A-${tag}`,
    sellingPrice: 999,
    priceFloor: 888.88,
    avgCost: 13579.24,
    stockQty: 86420,
    reservedQty: 4321,
    photos: [photo],
    photoUrl: photo,
  });
  const carton = await mk({ name: `Carton ${tag}`, sku: `LEAKSKU-C-${tag}`, productType: "COMPONENT", avgCost: 77.77, stockQty: 55555 });
  const red = await mk({ name: `Red Saree ${tag}`, sku: `LEAKSKU-R-${tag}`, sellingPrice: 500, avgCost: 321.09, stockQty: 3, photos: [optionPhoto], photoUrl: optionPhoto });
  const blue = await mk({ name: `Blue Saree ${tag}`, sku: `LEAKSKU-B-${tag}`, sellingPrice: 500, avgCost: 321.09, stockQty: 0 });
  const hidden = await mk({ name: `Hidden ${tag}`, sku: `LEAKSKU-H-${tag}`, sellingPrice: 10, photos: [hiddenPhoto], photoUrl: hiddenPhoto });
  await tx.purchase.create({
    data: {
      supplierName: `Suppliername${tag}`,
      purchaseDate: new Date(),
      totalAmount: 2468.13,
      createdBy: staff.id,
      items: { create: [{ productId: choc.id, qty: 1, unitCost: 2468.13, lineTotal: 2468.13 }] },
    },
  });

  const pkg = await tx.package.create({
    data: {
      code: `LEAKPKG-${tag}`,
      name: `Leaktest Hamper ${tag}`,
      sellingPrice: 1500,
      priceFloor: 1111.11,
      createdBy: staff.id,
      showOnWebsite: false,
      items: {
        create: [
          { kind: "PRODUCT", productId: choc.id, qty: 2 },
          { kind: "PRODUCT", productId: carton.id, qty: 1 },
          {
            kind: "CHOICE",
            choiceLabel: "Saree colour",
            qty: 1,
            options: { create: [{ productId: red.id, isDefault: true, extraPrice: 0 }, { productId: blue.id, extraPrice: 300 }] },
          },
        ],
      },
    },
    include: { items: { include: { options: true } } },
  });

  const ctx = (name: string, code: string, price: number) => ({
    userId: staff.id, name, code, price, notEligible: null, isActive: true,
  });
  await applyWebsite(tx, "product", choc.id, { showOnWebsite: true, websiteBadge: "NEW", websiteFeatured: true, compareAtPrice: 1200, websiteDescription: "Rich **dark** chocolate.\n\n- 70% cocoa\n- Gift wrapped" }, ctx(choc.name, choc.sku, 999));
  await applyWebsite(tx, "package", pkg.id, { showOnWebsite: true, websiteCategoryIds: [category.id], websiteShowContents: true }, ctx(pkg.name, pkg.code, 1500));
  await applyWebsite(tx, "product", hidden.id, { showOnWebsite: false }, ctx(hidden.name, hidden.sku, 10));

  const sentinels = {
    strings: [
      `LEAKSKU`, `LEAKPKG`, staff.name, staff.email, staff.phone!, customer.name, customer.phoneForeign, `Suppliername${tag}`,
      `Carton ${tag}`, `Hidden ${tag}`,
    ],
    numbers: [13579.24, 86420, 4321, 86420 - 4321, 1111.11, 888.88, 2468.13, 77.77, 55555, 321.09],
  };
  const saree = pkg.items.find((i) => i.kind === "CHOICE")!;
  return { tag, staff, category, choc, carton, red, blue, hidden, pkg, saree, photo, optionPhoto, hiddenPhoto, sentinels };
}

const slugOf = async (tx: Tx, kind: "product" | "package" | "category", id: number) =>
  kind === "product"
    ? (await tx.product.findUniqueOrThrow({ where: { id }, select: { slug: true } })).slug!
    : kind === "package"
      ? (await tx.package.findUniqueOrThrow({ where: { id }, select: { slug: true } })).slug!
      : (await tx.category.findUniqueOrThrow({ where: { id }, select: { slug: true } })).slug!;

describe("W-3 one public catalog gate — the leak scan", () => {
  test("every export of lib/storefront/catalog.ts is scanned here", () => {
    const exported = Object.entries(catalog).filter(([, v]) => typeof v === "function").map(([k]) => k).sort();
    assert.deepEqual(exported, [...SCANNED].sort());
  });

  test("no public read returns cost, stock numbers, SKU/code, supplier, staff or customer data", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const chocSlug = await slugOf(tx, "product", f.choc.id);
      const pkgSlug = await slugOf(tx, "package", f.pkg.id);
      const catSlug = await slugOf(tx, "category", f.category.id);

      const outputs: [string, unknown][] = [
        ["listWebCategories", await catalog.listWebCategories(tx)],
        ["listWebItems", await catalog.listWebItems({}, tx)],
        ["listWebItems(featured)", await catalog.listWebItems({ featured: true }, tx)],
        ["getWebCategory", await catalog.getWebCategory(catSlug, tx)],
        ["searchWebItems(tag)", await catalog.searchWebItems(f.tag, tx)],
        ["searchWebItems(leaktest)", await catalog.searchWebItems("leaktest", tx)],
        ["getWebItem(product)", await catalog.getWebItem(chocSlug, tx)],
        ["getWebItem(package)", await catalog.getWebItem(pkgSlug, tx)],
        ["relatedWebItems(product)", await catalog.relatedWebItems(chocSlug, 8, tx)],
        ["relatedWebItems(package)", await catalog.relatedWebItems(pkgSlug, 8, tx)],
        ["getWebSettings", await catalog.getWebSettings(tx)],
        ["listWebCurrencies", await catalog.listWebCurrencies(tx)],
        [
          "webBagLines",
          await catalog.webBagLines(
            [
              { kind: "product", slug: chocSlug, picks: {} },
              { kind: "package", slug: pkgSlug, picks: { [String(f.saree.id)]: f.blue.id } },
              { kind: "package", slug: pkgSlug, picks: { "999999999": 1 } },
              { kind: "product", slug: "no-such-gift", picks: {} },
            ],
            tx
          ),
        ],
      ];
      // W-7 / W-8 — the home page, the sitemap, the pixel.
      const refs = [
        { kind: "product" as const, id: f.choc.id },
        { kind: "package" as const, id: f.pkg.id },
        { kind: "product" as const, id: f.hidden.id },
        { kind: "product" as const, id: f.carton.id },
      ];
      const layout = {
        version: 1 as const,
        sections: [
          { id: "c", kind: "categories" as const, enabled: true, title: "", mode: "HAND" as const, categoryIds: [f.category.id] },
          { id: "i", kind: "items" as const, enabled: true, title: "", mode: "HAND" as const, refs, categoryId: null, count: 12 },
          { id: "k", kind: "items" as const, enabled: true, title: "", mode: "CATEGORY" as const, refs: [], categoryId: f.category.id, count: 12 },
          { id: "p", kind: "photo_box" as const, enabled: true, ref: refs[1] },
          { id: "a", kind: "all" as const, enabled: true, title: "", count: 24 },
        ],
      };
      outputs.push(
        ["getWebPixelId", { pixel: await catalog.getWebPixelId(tx) }],
        ["listWebAddresses", await catalog.listWebAddresses(tx)],
        ["buildHomeView(published)", await buildHomeView(await catalog.getHomeLayout("published", tx), tx)],
        ["buildHomeView(draft)", await buildHomeView(await catalog.getHomeLayout("draft", tx), tx)],
        ["webItemsByRefs", await catalog.webItemsByRefs(refs, tx)],
        ["webCategoriesByIds", await catalog.webCategoriesByIds([f.category.id], tx)],
        ["webCategoryCards", await catalog.webCategoryCards(f.category.id, 12, tx)],
        ["buildHomeView", await buildHomeView(layout, tx)]
      );
      for (const [label, out] of outputs) {
        assert.ok(out, `${label} returned something`);
        scan(label, JSON.parse(JSON.stringify(out)), f.sentinels);
      }
      // Hand-picked: in the order chosen; hidden and COMPONENT items drop out.
      assert.deepEqual(
        (await catalog.webItemsByRefs(refs, tx)).map((c) => c.name),
        ["লিকটেস্ট চকলেট", `Leaktest Hamper ${f.tag}`]
      );
      const addresses = await catalog.listWebAddresses(tx);
      const chocSlugNow = await slugOf(tx, "product", f.choc.id);
      assert.ok(addresses.items.some((i) => i.slug === chocSlugNow));
      const hiddenSlug = (await tx.product.findUniqueOrThrow({ where: { id: f.hidden.id }, select: { slug: true } })).slug;
      if (hiddenSlug) assert.ok(!addresses.items.some((i) => i.slug === hiddenSlug), "a hidden item is not in the sitemap");
    });
  });

  test("W-8 the pixel: only while switched on with a Pixel ID and a token — and never the token", async () => {
    await inRollback(async (tx) => {
      await tx.metaTracking.upsert({
        where: { id: "meta" },
        create: { id: "meta", isEnabled: false, pixelId: "112233445566", accessTokenEncrypted: "SENTINEL-TOKEN-CIPHERTEXT" },
        update: { isEnabled: false, pixelId: "112233445566", accessTokenEncrypted: "SENTINEL-TOKEN-CIPHERTEXT" },
      });
      assert.equal(await catalog.getWebPixelId(tx), null, "off → no pixel");
      await tx.metaTracking.update({ where: { id: "meta" }, data: { isEnabled: true } });
      assert.equal(await catalog.getWebPixelId(tx), "112233445566");
      await tx.metaTracking.update({ where: { id: "meta" }, data: { accessTokenEncrypted: null } });
      assert.equal(await catalog.getWebPixelId(tx), null, "no token → no pixel");
    });
  });

  test("W-7 a banner photo is public only while the published page or the draft uses it", async () => {
    await inRollback(async (tx) => {
      const file = `banner-${randomUUID()}`;
      assert.equal(await catalog.publicPhotoFile(file, tx), null);
      const banner = {
        id: "b1", enabled: true, text: "Eid", subtext: "", link: "", placeholder: false,
        desktop: { file: `${file}.webp`, width: 1920, height: 700 }, mobile: { file: `${file}.webp`, width: 1080, height: 1350 },
        startsAt: null, endsAt: null,
      };
      const draft = { version: 1, sections: [{ id: "banners", kind: "banners", enabled: true, items: [banner] }] };
      await tx.homePage.upsert({ where: { id: "home" }, create: { id: "home", draft }, update: { draft } });
      assert.match((await catalog.publicPhotoFile(file, tx)) ?? "", new RegExp(`${file}\\.webp$`));
      const other = `banner-${randomUUID()}`;
      assert.equal(await catalog.publicPhotoFile(other, tx), null, "a banner no layout uses is a 404");
    });
  });
});

describe("W-3 what the gate returns", () => {
  test("shown items only; price, compare-at, badge, words for stock, what's inside", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const chocSlug = await slugOf(tx, "product", f.choc.id);
      const pkgSlug = await slugOf(tx, "package", f.pkg.id);
      assert.match(chocSlug, /^[a-z0-9-]+$/, "Bangla name → Latin address");
      assert.ok(chocSlug.includes("chokolet") || chocSlug.includes("choklet") || chocSlug.length > 3, chocSlug);

      const product = await catalog.getWebItem(chocSlug, tx);
      assert.ok(product && "item" in product);
      assert.equal(product.item.kind, "product");
      assert.equal(product.item.price, 999);
      assert.equal(product.item.compareAtPrice, 1200);
      assert.equal(product.item.badge, "NEW");
      assert.equal(product.item.stock, "IN_STOCK");
      assert.equal(product.item.photos.length, 1);
      assert.match(product.item.photos[0].path, /^\/img\/[0-9a-f-]+$/);
      assert.deepEqual(product.item.description, parseRichText("Rich **dark** chocolate.\n\n- 70% cocoa\n- Gift wrapped"));
      assert.equal(product.item.categories.length, 1);

      const pkg = await catalog.getWebItem(pkgSlug, tx);
      assert.ok(pkg && "item" in pkg);
      assert.equal(pkg.item.price, 1500, "default pick (Red, +0)");
      assert.equal(pkg.item.choiceGroups.length, 1);
      const g = pkg.item.choiceGroups[0];
      assert.equal(g.key, f.saree.id);
      assert.deepEqual(
        g.options.map((o) => [o.name, o.extraPrice, o.isDefault, o.stock]),
        [
          [`Red Saree ${f.tag}`, 0, true, "IN_STOCK"],
          [`Blue Saree ${f.tag}`, 300, false, "OUT_OF_STOCK"],
        ]
      );
      assert.ok(g.options[0].image, "option photo from the option product");
      assert.equal(pkg.item.stock, "IN_STOCK");
      // Packing materials are not "what's inside".
      assert.deepEqual(
        pkg.item.contents!.map((c) => [c.name, c.qty, c.choice]),
        [
          ["লিকটেস্ট চকলেট", 2, false],
          ["Saree colour", 1, true],
        ]
      );

      // Hidden, COMPONENT and non-website items never show.
      const all = await catalog.listWebItems({ take: 200 }, tx);
      const names = all.map((c) => c.name);
      assert.ok(names.includes("লিকটেস্ট চকলেট"));
      assert.ok(names.includes(`Leaktest Hamper ${f.tag}`));
      for (const n of [`Hidden ${f.tag}`, `Carton ${f.tag}`, `Red Saree ${f.tag}`]) assert.ok(!names.includes(n), n);
      const hiddenSlug = await slugOf(tx, "product", f.hidden.id);
      assert.equal(await catalog.getWebItem(hiddenSlug, tx), null);

      // Stock is net of reservations: reserve everything → out of stock.
      await tx.product.update({ where: { id: f.red.id }, data: { reservedQty: 3 } });
      const after = await catalog.getWebItem(pkgSlug, tx);
      assert.ok(after && "item" in after);
      assert.equal(after.item.stock, "OUT_OF_STOCK");

      // The category page lists the product (its category) and the package (website category).
      const cat = await catalog.getWebCategory(await slugOf(tx, "category", f.category.id), tx);
      assert.ok(cat && "category" in cat);
      assert.deepEqual(cat.items.map((c) => c.kind).sort(), ["package", "product"]);
    });
  });

  test("photos: shown items and options of shown packages only", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const base = (u: string) => u.slice("/uploads/".length).replace(/\.\w+$/, "");
      assert.ok(await catalog.publicPhotoFile(base(f.photo), tx));
      assert.ok(await catalog.publicPhotoFile(base(f.optionPhoto), tx));
      assert.equal(await catalog.publicPhotoFile(base(f.hiddenPhoto), tx), null);
      assert.equal(await catalog.publicPhotoFile("../etc/passwd", tx), null);
      await applyWebsite(tx, "package", f.pkg.id, { showOnWebsite: false }, {
        userId: f.staff.id, name: f.pkg.name, code: f.pkg.code, price: 1500, notEligible: null, isActive: true,
      });
      assert.equal(await catalog.publicPhotoFile(base(f.optionPhoto), tx), null, "package hidden → option photo gone");
    });
  });
});

describe("W-2 the Website panel's server path", () => {
  test("a changed published address keeps the old one as a redirect; audited as catalog.website", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const old = await slugOf(tx, "product", f.choc.id);
      const ctx = { userId: f.staff.id, name: f.choc.name, code: f.choc.sku, price: 999, notEligible: null, isActive: true };
      await applyWebsite(tx, "product", f.choc.id, { slug: `dark-choc-${f.tag}` }, ctx);
      assert.deepEqual(await catalog.getWebItem(old, tx), { redirectTo: `dark-choc-${f.tag}` });
      // The address can't be taken by a package (shared /p/ space) — nor the old one.
      const pctx = { userId: f.staff.id, name: f.pkg.name, code: f.pkg.code, price: 1500, notEligible: null, isActive: true };
      await assert.rejects(applyWebsite(tx, "package", f.pkg.id, { slug: `dark-choc-${f.tag}` }, pctx), WebsiteInputError);
      await assert.rejects(applyWebsite(tx, "package", f.pkg.id, { slug: old }, pctx), WebsiteInputError);
      await assert.rejects(applyWebsite(tx, "product", f.choc.id, { slug: "Not A Slug!" }, ctx), WebsiteInputError);
      // Reclaiming its own old address removes the redirect.
      await applyWebsite(tx, "product", f.choc.id, { slug: old }, ctx);
      const back = await catalog.getWebItem(old, tx);
      assert.ok(back && "item" in back);
      const rows = await tx.auditLog.findMany({ where: { action: "catalog.website", entity: "products", entityId: String(f.choc.id) } });
      assert.ok(rows.length >= 3, "each change audited");
    });
  });

  test("COMPONENT never shown; compare-at must be above the price; photos must be ours", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      await applyWebsite(tx, "product", f.carton.id, { showOnWebsite: true }, {
        userId: f.staff.id, name: f.carton.name, code: f.carton.sku, price: null,
        notEligible: "Component-only products are never sold on the website", isActive: true,
      });
      const carton = await tx.product.findUniqueOrThrow({ where: { id: f.carton.id }, select: { showOnWebsite: true } });
      assert.equal(carton.showOnWebsite, false);
      const ctx = { userId: f.staff.id, name: f.choc.name, code: f.choc.sku, price: 999, notEligible: null, isActive: true };
      await assert.rejects(applyWebsite(tx, "product", f.choc.id, { compareAtPrice: 999 }, ctx), /must be above the price/);
      await assert.rejects(applyWebsite(tx, "product", f.choc.id, { photos: ["/uploads/not-there.jpg"] }, ctx), /Upload the photo again/);
      await assert.rejects(applyWebsite(tx, "product", f.choc.id, { photos: ["https://evil.example/x.jpg"] }, ctx), /Upload the photo again/);
      // Verify R3 — never a private file from the same folder: a receipt (or a
      // payment screenshot), a category photo, a print upload.
      const receipt = `/uploads/${randomUUID()}.jpg`;
      const receiptFile = uploadUrlPath(receipt)!;
      mkdirSync(path.dirname(receiptFile), { recursive: true });
      writeFileSync(receiptFile, "x");
      try {
        const expenseCategory = await tx.expenseCategory.findFirstOrThrow();
        await tx.expense.create({ data: { expenseDate: new Date(), categoryId: expenseCategory.id, amount: 1, receiptUrl: receipt } });
        await assert.rejects(applyWebsite(tx, "product", f.choc.id, { photos: [receipt] }, ctx), /payment screenshot or a receipt/);
      } finally {
        unlinkSync(receiptFile);
      }
      for (const url of [`/uploads/category-${randomUUID()}.webp`, `/uploads/print/${randomUUID()}.jpg`, `/uploads/banner-${randomUUID()}.webp`]) {
        await assert.rejects(applyWebsite(tx, "product", f.choc.id, { photos: [url] }, ctx), /Upload the photo again/, url);
      }
      // Reordering existing photos is fine, and the first becomes the ERP photo.
      await tx.product.update({ where: { id: f.choc.id }, data: { photos: [f.photo, f.optionPhoto] } });
      await applyWebsite(tx, "product", f.choc.id, { photos: [f.optionPhoto, f.photo] }, ctx);
      const row = await tx.product.findUniqueOrThrow({ where: { id: f.choc.id }, select: { photoUrl: true, photos: true } });
      assert.equal(row.photoUrl, f.optionPhoto);
    });
  });
});

describe("W-3 the website reads only through the gate", () => {
  const walk = (dir: string): string[] =>
    existsSync(dir)
      ? readdirSync(dir).flatMap((n) => {
          const full = path.join(dir, n);
          return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(n) ? [full] : [];
        })
      : [];

  test("app/(store) and components/storefront never touch Prisma or the ERP's catalog code", () => {
    const offenders = [...walk(path.join(ROOT, "app/(store)")), ...walk(path.join(ROOT, "components/storefront"))]
      .filter((f) => /from\s+["'](@\/lib\/db|@prisma\/client|@\/lib\/bom-db|@\/lib\/catalog|@\/lib\/catalog-website)["']/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    assert.deepEqual(offenders, []);
  });

  // ROUND3 W-5 — place-order.ts is the website's one write (an order, as a
  // draft) and its private receipt; tests/website-orders scans both answers.
  test("inside lib/storefront only catalog.ts (reads) and place-order.ts (the order) touch the database", () => {
    const offenders = walk(path.join(ROOT, "lib/storefront"))
      .filter((f) => !f.endsWith(`${path.sep}catalog.ts`) && !f.endsWith(`${path.sep}place-order.ts`))
      .filter((f) => /from\s+["'](@\/lib\/db|@prisma\/client|@\/lib\/bom-db)["']/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    assert.deepEqual(offenders, []);
  });

  test("the catalog gate selects, never includes", () => {
    // The one `code: true` allowed is the ISO currency code (W-4 approx. price).
    const src = readFileSync(path.join(ROOT, "lib/storefront/catalog.ts"), "utf8").replace(
      /const CURRENCY_SELECT = \{ code: true, name: true, symbol: true, bdtPerUnit: true \}/,
      ""
    );
    assert.doesNotMatch(src, /\binclude\s*:/);
    assert.doesNotMatch(src, /(avgCost|stockQty|sku|code|priceFloor|unitCost|phone|email|createdBy|updatedBy):\s*true/);
  });
});
