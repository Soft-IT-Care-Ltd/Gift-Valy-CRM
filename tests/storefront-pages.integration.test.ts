// ROUND3 W-4 + W-9 — the website pages' arithmetic and the cache rules.
// Run: npm run test:storefront-pages (needs DATABASE_URL; the fixture runs
// inside ONE transaction that is rolled back — no order is ever made).
//
// 1. The product page's live total (price + Σ the picks' priceDelta,
//    lib/storefront/picks.ts) equals packagePrice() — R3-2's one price
//    function — for EVERY combination of picks: a choice of qty 2, a choice
//    inside a sub-package, a negative extra price. Also for every real package
//    on the dev database. The print-kit photo count follows the picks the
//    same way.
// 2. Every API route that writes the catalog (products, packages, categories,
//    the bulk Website switch) or the currency rates clears the website cache,
//    and the one stock write path does too.
// 3. Settings → Website is read tolerantly; the WhatsApp message drops an
//    empty line; the pages never import the database.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { prisma as appPrisma } from "../lib/db";
import { loadBomCatalog } from "../lib/bom-db";
import { packagePrice, packagePrintKitNeeds } from "../lib/bom";
import { printKitPhotoCount } from "../lib/print-kit";
import { applyWebsite } from "../lib/catalog-website";
import * as catalog from "../lib/storefront/catalog";
import { initialPicks, liveKit, liveStock, liveTotal, type Picks } from "../lib/storefront/picks";
import { fillTemplate, unknownPlaceholders } from "../lib/storefront/chat";
import { normalizeWebSettings, DEFAULT_PRODUCT_MESSAGE } from "../lib/storefront/settings-shape";
import { formatExtra, formatTaka } from "../lib/storefront/format";
import type { WebChoiceGroup } from "../lib/storefront/types";

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

/** Every combination of one option per group. */
function combos(groups: WebChoiceGroup[]): Picks[] {
  let out: Picks[] = [{}];
  for (const g of groups) out = out.flatMap((p) => g.options.map((o) => ({ ...p, [g.key]: o.key })));
  return out;
}

const kitOf = (needs: ReturnType<typeof packagePrintKitNeeds>) => ({
  photos: needs.reduce((s, n) => s + printKitPhotoCount(n.kit) * n.units, 0),
  cards: needs.reduce((s, n) => s + n.kit.cards.length * n.units, 0),
});

describe("W-4 the live total is packagePrice()", () => {
  test("every pick combination: qty 2, a choice inside a sub-package, a negative extra, a print kit", async () => {
    await inRollback(async (tx) => {
      const tag = randomUUID().slice(0, 8);
      const staff = await tx.user.findFirstOrThrow({ select: { id: true } });
      const category = await tx.category.create({ data: { name: `Pages Cat ${tag}`, createdBy: staff.id } });
      const mk = (name: string, extra: Partial<Prisma.ProductUncheckedCreateInput> = {}) =>
        tx.product.create({
          data: { name: `${name} ${tag}`, sku: `PGT-${name}-${tag}`, categoryId: category.id, sellingPrice: 100, stockQty: 50, createdBy: staff.id, updatedBy: staff.id, ...extra },
        });
      const red = await mk("Red");
      const blue = await mk("Blue");
      const green = await mk("Green");
      const plain = await mk("Plain");
      const photoBox = await mk("PhotoBox", { printKit: { photos: { PHOTO_L: 10, PHOTO_S: 4 }, cards: ["CARD_1", "CARD_2"] } });
      const choc = await mk("Choc");

      // Sub-package: its own choice (Plain +0 default / PhotoBox −100).
      const child = await tx.package.create({
        data: {
          code: `PGT-C-${tag}`,
          name: `Child ${tag}`,
          sellingPrice: 900,
          createdBy: staff.id,
          items: {
            create: [
              { kind: "PRODUCT", productId: choc.id, qty: 1 },
              { kind: "CHOICE", choiceLabel: "Box", qty: 1, options: { create: [{ productId: plain.id, isDefault: true, extraPrice: 0 }, { productId: photoBox.id, extraPrice: -100 }] } },
            ],
          },
        },
      });
      // Root: a choice of qty 2 (Red +0 default / Blue +300 / Green +125.50) and the sub-package twice.
      const root = await tx.package.create({
        data: {
          code: `PGT-R-${tag}`,
          name: `Root ${tag}`,
          sellingPrice: 2500,
          createdBy: staff.id,
          items: {
            create: [
              { kind: "CHOICE", choiceLabel: "Saree", qty: 2, options: { create: [{ productId: red.id, isDefault: true, extraPrice: 0 }, { productId: blue.id, extraPrice: 300 }, { productId: green.id, extraPrice: 125.5 }] } },
              { kind: "PACKAGE", childPackageId: child.id, qty: 2 },
            ],
          },
        },
      });
      await applyWebsite(tx, "package", root.id, { showOnWebsite: true }, { userId: staff.id, name: root.name, code: root.code, price: 2500, notEligible: null, isActive: true });
      const slug = (await tx.package.findUniqueOrThrow({ where: { id: root.id }, select: { slug: true } })).slug!;

      const got = await catalog.getWebItem(slug, tx);
      assert.ok(got && "item" in got);
      const item = got.item;
      assert.equal(item.choiceGroups.length, 2);
      const saree = item.choiceGroups.find((g) => g.label === "Saree")!;
      const box = item.choiceGroups.find((g) => g.label === "Box")!;
      assert.equal(saree.qty, 2);
      assert.equal(box.qty, 2, "sub-package used twice → its choice counts twice");
      assert.deepEqual(box.path, [`Child ${tag}`]);

      const bom = await loadBomCatalog(tx);
      let checked = 0;
      for (const picks of combos(item.choiceGroups)) {
        const expected = packagePrice(bom, root.id, picks).unitPrice;
        assert.equal(liveTotal(item.price, item.choiceGroups, picks), expected, JSON.stringify(picks));
        assert.deepEqual(
          liveKit({ photos: item.printPhotos, cards: item.printCards }, item.choiceGroups, picks),
          kitOf(packagePrintKitNeeds(bom, root.id, picks)),
          `kit ${JSON.stringify(picks)}`
        );
        checked++;
      }
      assert.equal(checked, 6);
      // Spot values: Blue ×2 = +600; PhotoBox (−100) inside the sub-package ×2 = −200.
      assert.equal(liveTotal(item.price, item.choiceGroups, { [saree.key]: blue.id, [box.key]: photoBox.id }), 2500 + 600 - 200);
      assert.equal(liveKit({ photos: item.printPhotos, cards: item.printCards }, item.choiceGroups, { [saree.key]: red.id, [box.key]: photoBox.id }).photos, 28);
      assert.equal(item.printPhotos, 0, "default picks need no photos");

      // An option out of stock is never the starting pick; the item shows out of stock only for that pick.
      await tx.product.update({ where: { id: red.id }, data: { stockQty: 0 } });
      const again = await catalog.getWebItem(slug, tx);
      assert.ok(again && "item" in again);
      const groups = again.item.choiceGroups;
      const start = initialPicks(groups);
      const sareeAgain = groups.find((g) => g.label === "Saree")!;
      assert.notEqual(start[sareeAgain.key], red.id);
      assert.equal(liveStock(again.item.stock, groups, start), "IN_STOCK");
      assert.equal(liveStock(again.item.stock, groups, { ...start, [sareeAgain.key]: red.id }), "OUT_OF_STOCK");
    });
  });

  test("every shown package on the dev database: every pick combination", async () => {
    const bom = await loadBomCatalog(appPrisma as unknown as Tx);
    const items = await catalog.listWebItems({ take: 200 });
    let checked = 0;
    for (const card of items.filter((c) => c.kind === "package")) {
      const got = await catalog.getWebItem(card.slug);
      assert.ok(got && "item" in got);
      const pkg = await appPrisma.package.findFirstOrThrow({ where: { slug: card.slug }, select: { id: true } });
      for (const picks of combos(got.item.choiceGroups).slice(0, 50)) {
        assert.equal(liveTotal(got.item.price, got.item.choiceGroups, picks), packagePrice(bom, pkg.id, picks).unitPrice, `${card.slug} ${JSON.stringify(picks)}`);
        checked++;
      }
    }
    assert.ok(checked > 0 || items.every((c) => c.kind !== "package"));
  });
});

// ---------- W-9 ----------

const walk = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((n) => {
        const full = path.join(dir, n);
        return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(n) ? [full] : [];
      })
    : [];

describe("W-9 every change the website shows clears its cache", () => {
  test("each API route writing products, packages, categories, BOM lines, website fields or currency rates clears the cache", () => {
    const WRITES = /\b(tx|prisma|db)\.(product|package|packageItem|packageItemOption|category|packageWebsiteCategory|currencyRate)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b|\b(applyWebsite|writePackageItems)\(/;
    const routes = walk(path.join(ROOT, "app/api")).filter((f) => WRITES.test(readFileSync(f, "utf8")));
    assert.ok(routes.length >= 9, `found ${routes.length} catalog-writing routes`);
    const missing = routes
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        const calls = (src.match(/revalidateStorefront(Catalog|Settings)\(\)/g) ?? []).length;
        const handlers = (src.match(/^export async function (POST|PATCH|PUT|DELETE)\b/gm) ?? []).length;
        return calls < handlers;
      })
      .map((f) => path.relative(ROOT, f));
    assert.deepEqual(missing, [], "every writing handler calls revalidateStorefront…()");
  });

  test("the one stock write path clears the catalog (In stock / Out of stock words)", () => {
    const src = readFileSync(path.join(ROOT, "lib/stock.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function applyMovements"), src.indexOf("// ---------- order requirements"));
    assert.match(body, /revalidateStorefrontCatalog\(\)/);
  });

  test("the cache is cleared at once (expire: 0), never served stale after a save; 10 minutes is the safety net", () => {
    const src = readFileSync(path.join(ROOT, "lib/storefront/revalidate.ts"), "utf8");
    assert.match(src, /revalidateTag\(tag, \{ expire: 0 \}\)/);
    assert.match(src, /STOREFRONT_REVALIDATE_SECONDS = 600;/);
    for (const page of ["page.tsx", "p/[slug]/page.tsx", "c/[slug]/page.tsx", "policy/[kind]/page.tsx"]) {
      assert.match(readFileSync(path.join(ROOT, "app/(store)/storefront", page), "utf8"), /export const revalidate = 600;/, page);
    }
  });

  test("pages read through the cached gate; search and the signed home page preview alone read live", () => {
    const pages = walk(path.join(ROOT, "app/(store)")).filter((f) => f.endsWith("page.tsx"));
    for (const f of pages) {
      const src = readFileSync(f, "utf8");
      const direct = src.match(/from "@\/lib\/storefront\/catalog"/);
      if (direct) {
        const live = f.includes(`${path.sep}search${path.sep}`) || f.includes(`${path.sep}preview${path.sep}home${path.sep}`);
        assert.ok(live, `${path.relative(ROOT, f)} reads the catalog uncached`);
        if (f.includes(`${path.sep}preview${path.sep}`)) assert.match(src, /export const dynamic = "force-dynamic";/, "the preview is never cached");
      }
    }
  });

  // ROUND3 W-7 / W-8 — Settings → Website, the Meta settings and the home page
  // manager's Publish clear what the website caches, after the commit.
  test("Settings → Website, Meta and Publish clear the website's cache (and the proxy's Website on/off)", () => {
    const route = (p: string) => readFileSync(path.join(ROOT, "app/api", p), "utf8");
    const settings = route("settings/website/route.ts");
    assert.match(settings, /revalidateStorefrontSettings\(\);\s*forgetWebsiteStatus\(\);/);
    assert.match(route("settings/website/meta/route.ts"), /revalidateStorefrontSettings\(\)/);
    assert.match(route("website/home/publish/route.ts"), /publishHomePage\([^)]*\);\s*revalidateStorefrontHome\(\);/);
    // Saving a draft or discarding it changes nothing on the website: no cache to clear.
    assert.doesNotMatch(route("website/home/route.ts"), /revalidateStorefront/);
    // The home page's data is tagged with the home page's tag.
    assert.match(readFileSync(path.join(ROOT, "lib/storefront/cached.ts"), "utf8"), /\["sf-home"\],\s*opts\(\[STOREFRONT_TAGS\.home, STOREFRONT_TAGS\.catalog\]\)/);
  });
});

describe("W-4 settings, message, money", () => {
  test("Settings → Website is read tolerantly; unset = no button", () => {
    const empty = normalizeWebSettings(null);
    assert.equal(empty.whatsapp, "");
    assert.equal(empty.messengerPage, "");
    assert.equal(empty.approxCurrency, false);
    assert.equal(empty.productMessage, DEFAULT_PRODUCT_MESSAGE);
    const s = normalizeWebSettings({
      whatsapp: "+880 1711-223344",
      messengerPage: "@giftvaly",
      facebookUrl: "javascript:alert(1)",
      approxCurrency: "yes",
      policies: { delivery: "  Within 3 days.  ", nonsense: "x" },
    });
    assert.equal(s.whatsapp, "8801711223344");
    assert.equal(s.messengerPage, "giftvaly");
    assert.equal(s.facebookUrl, "", "only a facebook.com https link");
    assert.equal(s.approxCurrency, false, "only true switches it on");
    assert.equal(s.policies.delivery, "Within 3 days.");
    assert.equal(normalizeWebSettings({ whatsapp: "01711" }).whatsapp, "");
  });

  test("the WhatsApp message: product, choices, price, link; an empty line is dropped", () => {
    const withChoices = fillTemplate(DEFAULT_PRODUCT_MESSAGE, { product: "Moharani Saree Package", choices: "Saree Colour: red saree", price: "৳2,800", link: "https://giftvaly.com/p/moharani" });
    assert.equal(withChoices, "Hi Gift Valy! I'd like to order:\nMoharani Saree Package\nSaree Colour: red saree\nPrice: ৳2,800\nhttps://giftvaly.com/p/moharani");
    const plain = fillTemplate(DEFAULT_PRODUCT_MESSAGE, { product: "Cake", choices: "", price: "৳900", link: "https://giftvaly.com/p/cake" });
    assert.ok(!plain.includes("\n\n"));
    assert.deepEqual(unknownPlaceholders("{product} {colour} {price}"), ["{colour}"]);
  });

  test("money on the website", () => {
    assert.equal(formatTaka(142000), "৳1,42,000");
    assert.equal(formatTaka(125.5), "৳125.50");
    assert.equal(formatExtra(300), "+৳300");
    assert.equal(formatExtra(-100), "−৳100");
    assert.equal(formatExtra(0), null);
  });
});
