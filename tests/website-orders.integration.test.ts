// ROUND3 W-5 (bag + checkout → POST /api/shop/order) and W-6 (website orders
// in the ERP) against the dev database. Every database test runs inside ONE
// transaction that is rolled back: the catalog, the orders, the people and
// order_sequences are left as they were (CLAUDE.md rule 6 — the confirm test
// moves the counter inside the transaction, which then rolls back).
// Run: npm run test:website-orders (needs DATABASE_URL).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { prisma as appPrisma } from "../lib/db";
import { loadBomCatalog } from "../lib/bom-db";
import { packagePrice } from "../lib/bom";
import { confirmDraftTx, editedCodAmount, nextCodAmount, recomputeDue } from "../lib/orders";
import { dhakaYearMonth, formatOrderNo } from "../lib/order-number";
import { dhakaDateBound } from "../lib/order-constants";
import { getWebsiteUserId } from "../lib/system-user";
import { aggregateUserAchievement } from "../lib/targets";
import { monthKeyOf } from "../lib/targets-constants";
import { placeWebsiteOrder, websiteOrderByToken, WebsiteOrderError, WEB_REF } from "../lib/storefront/place-order";
import { isCalendarDate, normalizeBdMobile, normalizeSenderWhatsApp, phoneSpellings, type OrderRequestInput } from "../lib/storefront/checkout-shape";
import { allowOrderTry, ORDER_TRIES_PER_MINUTE, resetOrderTries } from "../lib/storefront/attempt-limit";
import { clientIp } from "../lib/storefront/client-ip";
import { ORDER_BODY_LIMIT } from "../lib/storefront/http";
import { WEBSITE_SETTINGS_KEY } from "../lib/storefront/settings-shape";
import { dealUnassignedWebsiteOrders } from "../lib/website-assignment";
import { assignWebsiteOrder, cancelWebsiteOrder, listUnassignedWebsiteOrders } from "../lib/website-orders";
import { POST as orderRoute } from "../app/(store)/storefront/api/shop/order/route";

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

/** A WebsiteOrderError with this status (and field, when given). */
const refused = (status: number, field?: string) => (e: unknown) => {
  assert.ok(e instanceof WebsiteOrderError, `expected a WebsiteOrderError, got ${String(e)}`);
  assert.equal(e.status, status, e.message);
  if (field) assert.equal(e.field, field);
  return true;
};

/** A KSA WhatsApp number nobody on the dev database has (5XXXXXXXX). */
const ksaPhone = () => `5${String(randomInt(10_000_000, 99_999_999))}`;

// ---------- fixture: the Eid Hamper on the website ----------
//   Teddy Set (৳200): choice "Teddy colour" Brown +0 (default) | White +50
//   Eid Hamper (৳1500): 1 W5 Chocolate + choice "Saree colour" Red +0 (default)
//     | Blue +300 + 1 Teddy Set. Delivery 100 / 150 / 200 per hamper.
//   W5 Chocolate (৳999) on its own, delivery 60 / 80 / 120.
//   Hamper Blue + White = 1500 + 300 + 50 = ৳1850.
async function fixture(tx: Tx) {
  const tag = `${Date.now().toString(36)}${randomInt(1000, 9999)}`;
  const cat = await tx.category.create({ data: { name: `TEST-W5 category ${tag}` } });
  const mk = (sku: string, name: string, data: Partial<Prisma.ProductUncheckedCreateInput> = {}) =>
    tx.product.create({
      data: { sku: `TEST-W5-${sku}-${tag}`, name, categoryId: cat.id, sellingPrice: 0, showOnWebsite: false, stockQty: 50, ...data },
    });
  const choc = await mk("CHOC", `W5 Chocolate ${tag}`, {
    sellingPrice: 999,
    showOnWebsite: true,
    slug: `w5-chocolate-${tag}`,
    deliveryChargeInsideDhaka: 60,
    deliveryChargeSubDhaka: 80,
    deliveryChargeOutsideDhaka: 120,
  });
  const red = await mk("RED", `W5 Red saree ${tag}`);
  const blue = await mk("BLUE", `W5 Blue saree ${tag}`, { stockQty: 3 });
  const brown = await mk("BROWN", `W5 Brown teddy ${tag}`);
  const white = await mk("WHITE", `W5 White teddy ${tag}`);
  const teddy = await tx.package.create({
    data: {
      code: `TEST-W5-TEDDY-${tag}`,
      name: `W5 Teddy Set ${tag}`,
      sellingPrice: 200,
      showOnWebsite: false,
      items: {
        create: [
          {
            kind: "CHOICE",
            choiceLabel: "Teddy colour",
            qty: 1,
            options: { create: [{ productId: brown.id, isDefault: true, extraPrice: 0 }, { productId: white.id, extraPrice: 50 }] },
          },
        ],
      },
    },
    include: { items: true },
  });
  const hamper = await tx.package.create({
    data: {
      code: `TEST-W5-HAMPER-${tag}`,
      name: `W5 Eid Hamper ${tag}`,
      sellingPrice: 1500,
      priceFloor: 1200,
      showOnWebsite: true,
      slug: `w5-eid-hamper-${tag}`,
      deliveryChargeInsideDhaka: 100,
      deliveryChargeSubDhaka: 150,
      deliveryChargeOutsideDhaka: 200,
      items: {
        create: [
          { kind: "PRODUCT", productId: choc.id, qty: 1 },
          {
            kind: "CHOICE",
            choiceLabel: "Saree colour",
            qty: 1,
            options: { create: [{ productId: red.id, isDefault: true, extraPrice: 0 }, { productId: blue.id, extraPrice: 300 }] },
          },
          { kind: "PACKAGE", childPackageId: teddy.id, qty: 1 },
        ],
      },
    },
    include: { items: true },
  });
  const gSaree = hamper.items.find((i) => i.kind === "CHOICE")!.id;
  const gTeddy = teddy.items.find((i) => i.kind === "CHOICE")!.id;
  return { tag, choc, red, blue, brown, white, teddy, hamper, gSaree, gTeddy };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** 2 × hamper (Blue + White) + 1 chocolate, Inside Dhaka: 3700 + 999 + (2×100 + 60) = ৳4959. */
function request(f: Fixture, phone: string, over: Partial<OrderRequestInput> = {}): OrderRequestInput {
  return {
    sender: { name: "Rahim Uddin", country: "KSA", whatsapp: `0${phone}` },
    recipient: { name: "Amma", phone: "০১৭১২৩৪৫৬৭৮", relation: "Mother", address: "House 1, Road 2, Dhanmondi, Dhaka", zone: "INSIDE_DHAKA" },
    delivery: { mode: "FIXED", date: dhakaDateBound(new Date(Date.now() + 3 * 86_400_000)).toISOString().slice(0, 10) },
    occasion: "Birthday",
    note: "Please call before delivery",
    lines: [
      { kind: "package", slug: f.hamper.slug!, picks: { [String(f.gSaree)]: f.blue.id, [String(f.gTeddy)]: f.white.id }, qty: 2, seenPrice: 1850 },
      { kind: "product", slug: f.choc.slug!, picks: {}, qty: 1, seenPrice: 999 },
    ],
    seenTotal: 4959,
    website: "",
    ...over,
  };
}

/** Just one chocolate, Inside Dhaka: 999 + 60 = ৳1059. */
function small(f: Fixture, phone: string): OrderRequestInput {
  return request(f, phone, { lines: [{ kind: "product", slug: f.choc.slug!, picks: {}, qty: 1, seenPrice: 999 }], seenTotal: 1059 });
}

async function counter(tx: Tx): Promise<number> {
  const row = await tx.orderSequence.findUnique({ where: { yearMonth: dhakaYearMonth() } });
  return row?.lastNumber ?? 0;
}

async function ordersFrom(tx: Tx, phone: string): Promise<number> {
  return tx.order.count({ where: { customer: { phoneForeign: { in: phoneSpellings(`+966${phone}`) } } } });
}

// ---------- the checkout's own checks (no database) ----------

describe("W-5 checkout fields", () => {
  test("the sender's WhatsApp: code in front, a 0 or a retyped code dropped, + taken as typed", () => {
    assert.equal(normalizeSenderWhatsApp("KSA", "0512345678"), "+966512345678");
    assert.equal(normalizeSenderWhatsApp("KSA", "512 345 678"), "+966512345678");
    assert.equal(normalizeSenderWhatsApp("KSA", "966512345678"), "+966512345678");
    assert.equal(normalizeSenderWhatsApp("KSA", "+971 50 123 4567"), "+971501234567");
    assert.equal(normalizeSenderWhatsApp("KSA", "00971501234567"), "+971501234567");
    assert.equal(normalizeSenderWhatsApp("UAE", "٠٥٠١٢٣٤٥٦٧"), "+971501234567", "Arabic digits");
    assert.equal(normalizeSenderWhatsApp("Italy", "3912345678"), "+393912345678", "an Italian mobile starting 39 keeps it");
    assert.equal(normalizeSenderWhatsApp("Other", "7700 900123"), null, "Other needs its code");
    assert.equal(normalizeSenderWhatsApp("Other", "+44 7700 900123"), "+447700900123");
    assert.equal(normalizeSenderWhatsApp("KSA", "12345"), null);
    assert.deepEqual(phoneSpellings("+966512345678").sort(), ["+966512345678", "00966512345678", "966512345678"]);
    assert.ok(phoneSpellings("+8801712345678").includes("01712345678"));
  });

  test("a fixed date must be a real day (Verify R3)", () => {
    assert.equal(isCalendarDate("2026-12-31"), true);
    assert.equal(isCalendarDate("2028-02-29"), true);
    assert.equal(isCalendarDate("2026-11-31"), false);
    assert.equal(isCalendarDate("2026-12-45"), false);
    assert.equal(isCalendarDate("2027-02-29"), false);
  });

  test("the recipient's Bangladeshi mobile", () => {
    assert.equal(normalizeBdMobile("01712345678"), "01712345678");
    assert.equal(normalizeBdMobile("+880 1712-345678"), "01712345678");
    assert.equal(normalizeBdMobile("৮৮০১৭১২৩৪৫৬৭৮"), "01712345678");
    assert.equal(normalizeBdMobile("1712345678"), "01712345678");
    assert.equal(normalizeBdMobile("01212345678"), null);
    assert.equal(normalizeBdMobile("0171234567"), null);
  });

  test("the visitor's IP: X-Real-IP (set by Nginx), else the first X-Forwarded-For", () => {
    assert.equal(clientIp(new Headers({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1" })), "203.0.113.9");
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "::ffff:198.51.100.7, 10.0.0.1" })), "198.51.100.7");
    assert.equal(clientIp(new Headers({ "x-real-ip": "not-an-ip" })), null);
  });
});

// ---------- POST /api/shop/order: refused at the door (no database) ----------

describe("W-5 the endpoint's door: same-site, JSON, body size, schema", () => {
  const url = "http://shop.localhost/storefront/api/shop/order";
  const post = (body: string, headers: Record<string, string> = {}) =>
    orderRoute(new Request(url, { method: "POST", body, headers: { host: "shop.localhost", "content-type": "application/json", ...headers } }));

  test("another site's page → 403; a foreign Origin → 403", async () => {
    assert.equal((await post("{}", { "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await post("{}", { origin: "https://evil.example" })).status, 403);
  });

  test("not JSON → 415; a body over 16 KB → 413; never cached", async () => {
    const plain = await post("{}", { "content-type": "text/plain" });
    assert.equal(plain.status, 415);
    assert.equal(plain.headers.get("cache-control"), "no-store");
    assert.equal((await post(JSON.stringify({ pad: "x".repeat(ORDER_BODY_LIMIT) }))).status, 413);
  });

  test("a malformed order → 400 with the field, before the database is asked anything", async () => {
    const res = await post(JSON.stringify({ sender: { name: "A" } }));
    assert.equal(res.status, 400);
    const body = (await res.json()) as { field: string | null };
    assert.ok(body.field);
  });
});

// ---------- the order itself ----------

describe("W-5 totals come from the database only", () => {
  test("prices = packagePrice() through a nested choice, qty 2; delivery Σ qty × zone; a DRAFT with no GV number", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const phone = ksaPhone();
      const before = await counter(tx);
      const placed = await placeWebsiteOrder(request(f, phone), { ip: "203.0.113.10" }, tx);

      const catalog = await loadBomCatalog(tx);
      const expected = packagePrice(catalog, f.hamper.id, new Map([[f.gSaree, f.blue.id], [f.gTeddy, f.white.id]]));
      assert.equal(expected.unitPrice, 1850);

      const o = await tx.order.findUniqueOrThrow({ where: { id: placed.orderId }, include: { items: { orderBy: { id: "asc" } }, customer: true, lead: true, statusHistory: true } });
      assert.equal(o.status, "DRAFT");
      assert.equal(o.source, "WEBSITE");
      assert.match(o.orderNo, /^DRAFT-\d{4,}$/);
      assert.match(placed.ref, WEB_REF);
      assert.equal(o.webRef, placed.ref);
      assert.equal(Number(o.items[0].unitPrice), expected.unitPrice);
      assert.equal(Number(o.items[0].lineTotal), 3700);
      assert.equal(Number(o.items[1].unitPrice), 999);
      assert.equal(Number(o.subtotal), 4699);
      assert.equal(Number(o.courierChargeCustomer), 260);
      assert.equal(Number(o.totalAmount), 4959);
      assert.equal(Number(o.dueAmount), 4959);
      assert.equal(Number(o.advanceAmount), 0);
      const picks = o.items[0].choiceSelections as { groupId: number; productId: number; extraPrice: number }[];
      assert.deepEqual(
        picks.map((p) => [p.groupId, p.productId, p.extraPrice]).sort(),
        [[f.gSaree, f.blue.id, 300], [f.gTeddy, f.white.id, 50]].sort()
      );
      // Two phones on every order (rule 5), both in their stored forms.
      assert.equal(o.customer.phoneForeign, `+966${phone}`);
      assert.equal(o.recipientPhoneBd, "01712345678");
      assert.equal(o.deliveryDateMode, "FIXED");
      assert.ok(o.requestedDeliveryDate);
      // The lead: source Website, committed, linked.
      assert.equal(o.lead?.source, "WEBSITE");
      assert.equal(o.lead?.status, "COMMITTED");
      assert.equal(o.statusHistory[0].toStatus, "DRAFT");
      // Nothing reserved, no number from the counter.
      assert.equal(await counter(tx), before, "order_sequences did not move");
      const blue = await tx.product.findUniqueOrThrow({ where: { id: f.blue.id } });
      assert.equal(blue.reservedQty, 0);
      const audit = await tx.auditLog.findFirst({ where: { action: "order.create.website", entityId: String(o.id) } });
      assert.equal((audit?.afterJson as { ip?: string }).ip, "203.0.113.10");
    });
  });

  test("a price, charge or total in the request is refused (400) — nothing is written", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const phone = ksaPhone();
      const base = request(f, phone);
      const tampered = [
        { ...base, lines: [{ ...base.lines[0], unitPrice: 1 }] },
        { ...base, total: 1 },
        { ...base, deliveryCharge: 0 },
        { ...base, discount: 4000 },
      ];
      for (const t of tampered) await assert.rejects(placeWebsiteOrder(t, { ip: null }, tx), refused(400));
      assert.equal(await ordersFrom(tx, phone), 0);
    });
  });

  test("an existing customer's saved name and country are never changed; what was typed stays on the order", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const phone = ksaPhone();
      const saved = await tx.customer.create({ data: { name: "Saved Name", phoneForeign: `966${phone}`, country: "UAE" } });
      const placed = await placeWebsiteOrder(request(f, phone), { ip: null }, tx);
      const o = await tx.order.findUniqueOrThrow({ where: { id: placed.orderId }, select: { customerId: true, webContact: true } });
      assert.equal(o.customerId, saved.id, "found by another spelling of the same number");
      const after = await tx.customer.findUniqueOrThrow({ where: { id: saved.id } });
      assert.equal(after.name, "Saved Name");
      assert.equal(after.country, "UAE");
      assert.equal(after.phoneForeign, `966${phone}`);
      assert.equal((o.webContact as { sender: { name: string } }).sender.name, "Rahim Uddin");
    });
  });

  test("seenPrice / seenTotal are read in exactly one place, which can only refuse", () => {
    const src = readFileSync(path.join(ROOT, "lib/storefront/place-order.ts"), "utf8");
    const fnAt = src.indexOf("function assertShownPrices(");
    assert.ok(fnAt > 0);
    const fnEnd = src.indexOf("\n}\n", fnAt);
    const outside = src.slice(0, fnAt) + src.slice(fnEnd);
    assert.doesNotMatch(outside.replace(/\/\/.*$|\/\*[^]*?\*\//gm, ""), /\.seen(Price|Total)\b/);
    assert.match(src.slice(fnAt, fnEnd), /throw new WebsiteOrderError\(copy\.api\.pricesChanged, 409/);
  });
});

describe("W-5 a changed price is refused with 409", () => {
  test("the page showed another price, or the price changed between the page and the order", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const phone = ksaPhone();
      const base = request(f, phone);
      await assert.rejects(
        placeWebsiteOrder({ ...base, lines: [{ ...base.lines[0], seenPrice: 1500 }, base.lines[1]], seenTotal: 4259 }, { ip: null }, tx),
        refused(409, "prices")
      );
      await assert.rejects(placeWebsiteOrder({ ...base, seenTotal: 4000 }, { ip: null }, tx), refused(409, "prices"));
      // The owner raises the hamper to ৳1600 after the page was shown.
      await tx.package.update({ where: { id: f.hamper.id }, data: { sellingPrice: 1600 } });
      await assert.rejects(placeWebsiteOrder(base, { ip: null }, tx), refused(409, "prices"));
      assert.equal(await ordersFrom(tx, phone), 0, "nothing written on a 409");
      await tx.customer.findMany({ where: { phoneForeign: `+966${phone}` } }).then((c) => assert.equal(c.length, 0));
      // The checkout re-reads the bag and shows ৳1950 a hamper; that order goes through.
      const fresh = { ...base, lines: [{ ...base.lines[0], seenPrice: 1950 }, base.lines[1]], seenTotal: 3900 + 999 + 260 };
      const placed = await placeWebsiteOrder(fresh, { ip: null }, tx);
      const o = await tx.order.findUniqueOrThrow({ where: { id: placed.orderId } });
      assert.equal(Number(o.totalAmount), 5159);
    });
  });

  test("an item gone from the website, a choice no longer offered, or stock sold out → 409", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const phone = ksaPhone();
      const base = request(f, phone);
      // 2 hampers with Blue need 2 Blue sarees; only 3 in stock, 2 held by confirmed orders.
      await tx.product.update({ where: { id: f.blue.id }, data: { reservedQty: 2 } });
      await assert.rejects(placeWebsiteOrder(base, { ip: null }, tx), refused(409, "lines"));
      await tx.product.update({ where: { id: f.blue.id }, data: { reservedQty: 0 } });
      await assert.rejects(
        placeWebsiteOrder({ ...base, lines: [{ ...base.lines[0], picks: { [String(f.gSaree)]: f.choc.id } }, base.lines[1]] }, { ip: null }, tx),
        refused(409, "lines")
      );
      await tx.product.update({ where: { id: f.choc.id }, data: { showOnWebsite: false } });
      await assert.rejects(placeWebsiteOrder(base, { ip: null }, tx), refused(409, "lines"));
      assert.equal(await ordersFrom(tx, phone), 0);
    });
  });
});

describe("W-5 limits", () => {
  test("the 6th order from one WhatsApp number in an hour → 429; an hour later it's fine", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const phone = ksaPhone();
      const now = new Date();
      for (let i = 0; i < 5; i++) await placeWebsiteOrder(small(f, phone), { ip: null, now: new Date(now.getTime() + i * 1000) }, tx);
      await assert.rejects(placeWebsiteOrder(small(f, phone), { ip: null, now: new Date(now.getTime() + 10_000) }, tx), refused(429, "sender.whatsapp"));
      // Another spelling of the same number is the same number.
      await assert.rejects(
        placeWebsiteOrder({ ...small(f, phone), sender: { name: "Rahim", country: "Other", whatsapp: `00966${phone}` } }, { ip: null, now: new Date(now.getTime() + 11_000) }, tx),
        refused(429)
      );
      await placeWebsiteOrder(small(f, phone), { ip: null, now: new Date(now.getTime() + 3_601_000) }, tx);
      assert.equal(await ordersFrom(tx, phone), 6);
    });
  });

  test("orders from one IP in an hour, from Settings → Website → 429; duplicates are flagged, not refused", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const existing = await tx.setting.findUnique({ where: { key: WEBSITE_SETTINGS_KEY } });
      const value = { ...((existing?.value as object | null) ?? {}), orderLimits: { phonePerHour: 5, ipPerHour: 2 } };
      await tx.setting.upsert({ where: { key: WEBSITE_SETTINGS_KEY }, create: { key: WEBSITE_SETTINGS_KEY, value }, update: { value } });
      const ip = "198.51.100.23";
      const phone = ksaPhone();
      const first = await placeWebsiteOrder(small(f, phone), { ip }, tx);
      const second = await placeWebsiteOrder(small(f, phone), { ip }, tx);
      assert.deepEqual(first.flags, []);
      assert.deepEqual(second.flags, ["LIKELY_DUPLICATE"]);
      await assert.rejects(placeWebsiteOrder(small(f, ksaPhone()), { ip }, tx), refused(429));
      await placeWebsiteOrder(small(f, ksaPhone()), { ip: "198.51.100.24" }, tx);
    });
  });

  test("Verify R3 — a flood of tries from one address is refused before the database (20 a minute)", () => {
    resetOrderTries();
    const t0 = 1_000_000;
    for (let i = 0; i < ORDER_TRIES_PER_MINUTE; i++) assert.equal(allowOrderTry("198.51.100.9", t0 + i), true);
    assert.equal(allowOrderTry("198.51.100.9", t0 + 100), false, "the 21st try in the minute");
    assert.equal(allowOrderTry("198.51.100.10", t0 + 100), true, "another address is its own count");
    assert.equal(allowOrderTry("198.51.100.9", t0 + 60_000), true, "a minute later it's fine");
    resetOrderTries();
    const src = readFileSync(path.join(process.cwd(), "lib/storefront/place-order.ts"), "utf8");
    assert.ok(src.includes("pg_try_advisory_xact_lock") && !/pg_advisory_xact_lock\(/.test(src), "the order's locks are tried, never waited on");
  });

  test("the honeypot field filled in → 400, nothing written", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const phone = ksaPhone();
      await assert.rejects(placeWebsiteOrder({ ...small(f, phone), website: "http://spam" }, { ip: null }, tx), refused(400));
      assert.equal(await ordersFrom(tx, phone), 0);
    });
  });
});

// ---------- W-6 assignment ----------

async function people(tx: Tx) {
  // Only this test's people are active Sales Executives (rolled back after).
  await tx.user.updateMany({ where: { role: { name: "SalesExecutive" } }, data: { isActive: false } });
  const role = async (name: string) => (await tx.role.findUniqueOrThrow({ where: { name } })).id;
  const tag = randomInt(100000, 999999);
  const mk = async (name: string, roleName: string, teamId: number | null) =>
    tx.user.create({ data: { name: `${name} ${tag}`, email: `w6-${name.toLowerCase()}-${tag}@example.test`, passwordHash: "x", roleId: await role(roleName), teamId } });
  const team = await tx.team.create({ data: { name: `TEST-W6 team ${tag}` } });
  const other = await tx.team.create({ data: { name: `TEST-W6 other ${tag}` } });
  const tl = await mk("Leader", "TeamLeader", team.id);
  await tx.team.update({ where: { id: team.id }, data: { leaderUserId: tl.id } });
  const otherTl = await mk("OtherLeader", "TeamLeader", other.id);
  await tx.team.update({ where: { id: other.id }, data: { leaderUserId: otherTl.id } });
  const a = await mk("Asha", "SalesExecutive", team.id);
  const b = await mk("Babu", "SalesExecutive", team.id);
  const manager = await mk("Manager", "Manager", null);
  return { team, other, tl, otherTl, a, b, manager };
}

const checkIn = (tx: Tx, userId: number, at: Date) =>
  tx.attendance.create({ data: { userId, date: dhakaDateBound(at), checkInAt: at } });

describe("W-6 assignment", () => {
  test("nobody in → next among all SEs + the TL told; checked in → round-robin; a repeat customer → their SE", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const p = await people(tx);
      const t0 = new Date();
      const at = (s: number) => new Date(t0.getTime() + s * 1000);
      const get = (id: number) => tx.order.findUniqueOrThrow({ where: { id }, select: { salesExecutiveId: true, teamId: true, webAssignReason: true, lead: { select: { assignedTo: true } } } });

      const phone1 = ksaPhone();
      const o1 = await placeWebsiteOrder(small(f, phone1), { ip: null, now: at(1) }, tx);
      const r1 = await get(o1.orderId);
      assert.equal(r1.salesExecutiveId, p.a.id, "nobody checked in → the first in turn (lowest id)");
      assert.equal(r1.webAssignReason, "NOBODY_IN");
      assert.equal(r1.teamId, p.team.id);
      assert.equal(r1.lead?.assignedTo, p.a.id);
      assert.equal(await tx.notification.count({ where: { userId: p.a.id, kind: "WEBSITE_ORDER" } }), 1, "the SE's bell");
      assert.equal(await tx.notification.count({ where: { userId: p.tl.id, kind: "WEBSITE_ORDER_NOBODY_IN" } }), 1, "the TL is told");

      await checkIn(tx, p.b.id, at(2));
      const o2 = await placeWebsiteOrder(small(f, ksaPhone()), { ip: null, now: at(3) }, tx);
      assert.deepEqual([(await get(o2.orderId)).salesExecutiveId, (await get(o2.orderId)).webAssignReason], [p.b.id, "ON_DUTY"]);

      await checkIn(tx, p.a.id, at(4));
      const o3 = await placeWebsiteOrder(small(f, ksaPhone()), { ip: null, now: at(5) }, tx);
      const o4 = await placeWebsiteOrder(small(f, ksaPhone()), { ip: null, now: at(6) }, tx);
      assert.equal((await get(o3.orderId)).salesExecutiveId, p.a.id, "A's last website order is older than B's");
      assert.equal((await get(o4.orderId)).salesExecutiveId, p.b.id, "then B");
      assert.equal(await tx.notification.count({ where: { userId: p.tl.id } }), 1, "no TL word while someone is in");

      // phone1 is A's customer. A checks out, B is the only one in — still A.
      await tx.attendance.updateMany({ where: { userId: p.a.id }, data: { checkOutAt: at(7) } });
      const o5 = await placeWebsiteOrder(small(f, phone1), { ip: null, now: at(8) }, tx);
      assert.deepEqual([(await get(o5.orderId)).salesExecutiveId, (await get(o5.orderId)).webAssignReason], [p.a.id, "OWN_CUSTOMER"]);
      const o6 = await placeWebsiteOrder(small(f, ksaPhone()), { ip: null, now: at(9) }, tx);
      assert.equal((await get(o6.orderId)).salesExecutiveId, p.b.id, "A checked out: only B is in");
    });
  });

  test("no active SE at all → unassigned (held by Website), listed, then dealt out once an SE is in", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const p = await people(tx);
      await tx.user.updateMany({ where: { id: { in: [p.a.id, p.b.id] } }, data: { isActive: false } });
      const websiteUserId = await getWebsiteUserId(tx);
      const o = await placeWebsiteOrder(small(f, ksaPhone()), { ip: null }, tx);
      const row = await tx.order.findUniqueOrThrow({ where: { id: o.orderId }, select: { salesExecutiveId: true, webAssignReason: true, lead: { select: { assignedTo: true } } } });
      assert.equal(row.salesExecutiveId, websiteUserId);
      assert.equal(row.webAssignReason, null);
      assert.equal(row.lead?.assignedTo, websiteUserId);
      assert.ok((await listUnassignedWebsiteOrders(tx, { withCustomer: false })).some((u) => u.id === o.orderId));
      assert.equal(await dealUnassignedWebsiteOrders(tx), 0, "still nobody to give it to");

      await tx.user.update({ where: { id: p.b.id }, data: { isActive: true } });
      await checkIn(tx, p.b.id, new Date());
      assert.ok((await dealUnassignedWebsiteOrders(tx)) >= 1);
      const dealt = await tx.order.findUniqueOrThrow({ where: { id: o.orderId }, select: { salesExecutiveId: true, webAssignReason: true, lead: { select: { assignedTo: true } } } });
      assert.deepEqual([dealt.salesExecutiveId, dealt.webAssignReason, dealt.lead?.assignedTo], [p.b.id, "ON_DUTY", p.b.id]);
      assert.equal(await tx.notification.count({ where: { userId: p.b.id, kind: "WEBSITE_ORDER" } }), 1);
    });
  });

  test("reassign: a Manager anywhere; a Team Leader only inside their own teams; only while a draft", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const p = await people(tx);
      const o = await placeWebsiteOrder(small(f, ksaPhone()), { ip: null }, tx);
      const holder = (await tx.order.findUniqueOrThrow({ where: { id: o.orderId } })).salesExecutiveId;
      const target = holder === p.a.id ? p.b : p.a;
      await assert.rejects(
        assignWebsiteOrder(tx, { userId: p.otherTl.id, anyTeam: false, teamIds: [p.other.id] }, { orderId: o.orderId, seId: target.id }),
        (e) => (e as { status?: number }).status === 404
      );
      await assignWebsiteOrder(tx, { userId: p.manager.id, anyTeam: true, teamIds: [] }, { orderId: o.orderId, seId: target.id });
      const moved = await tx.order.findUniqueOrThrow({ where: { id: o.orderId }, select: { salesExecutiveId: true, webAssignReason: true, lead: { select: { assignedTo: true } } } });
      assert.deepEqual([moved.salesExecutiveId, moved.webAssignReason, moved.lead?.assignedTo], [target.id, "MANUAL", target.id]);
      assert.ok(await tx.auditLog.findFirst({ where: { action: "order.assign", entityId: String(o.orderId) } }));
      await assignWebsiteOrder(tx, { userId: p.tl.id, anyTeam: false, teamIds: [p.team.id] }, { orderId: o.orderId, seId: holder });
    });
  });
});

// ---------- W-6 confirm and cancel ----------

describe("W-6 confirm and cancel (rule 6)", () => {
  test("confirm gives the GV number and moves order_sequences by exactly one; the lead converts", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const p = await people(tx);
      const placed = await placeWebsiteOrder(request(f, ksaPhone()), { ip: null }, tx);
      const before = await counter(tx);
      const { orderNo } = await confirmDraftTx(tx, placed.orderId, p.a.id, "Advance received on WhatsApp");
      const afterCount = await counter(tx);
      assert.equal(afterCount, before + 1, "exactly one");
      assert.equal(orderNo, formatOrderNo(dhakaYearMonth(), afterCount));
      const o = await tx.order.findUniqueOrThrow({ where: { id: placed.orderId }, include: { lead: true } });
      assert.equal(o.status, "CONFIRMED");
      assert.equal(o.webRef, placed.ref, "the reference stays");
      assert.equal(o.lead?.status, "CONVERTED");
      // Reserved now (Gift Valy reserves at CONFIRMED): 2 Blue sarees.
      assert.equal((await tx.product.findUniqueOrThrow({ where: { id: f.blue.id } })).reservedQty, 2);
      const receipt = await websiteOrderByToken(placed.token, tx);
      assert.equal(receipt?.number, orderNo);
      assert.equal(receipt?.state, "ACTIVE");
      assert.equal(receipt?.stepsDone, 1);
    });
  });

  test("the COD follows the due before handover: the courier never collects an advance already paid", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const p = await people(tx);
      const placed = await placeWebsiteOrder(request(f, ksaPhone()), { ip: null }, tx);
      const money = async () => {
        const o = await tx.order.findUniqueOrThrow({ where: { id: placed.orderId }, select: { totalAmount: true, dueAmount: true, codAmount: true } });
        return { total: Number(o.totalAmount), due: Number(o.dueAmount), cod: Number(o.codAmount) };
      };
      const pay = async (amount: number) => {
        const row = await tx.payment.create({ data: { orderId: placed.orderId, type: "ADVANCE", method: "CASH", amount, createdBy: p.a.id, updatedBy: p.a.id } });
        await recomputeDue(tx, placed.orderId);
        return row;
      };
      const start = await money();
      assert.equal(start.cod, start.total, "a website draft: COD = total, nothing paid yet");
      // The advance lands (the payments route: payment → recomputeDue → confirm).
      const advance = await pay(1000);
      await confirmDraftTx(tx, placed.orderId, p.a.id, null);
      let m = await money();
      assert.equal(m.due, start.total - 1000);
      assert.equal(m.cod, m.due, "COD = due after the advance (was the whole total before the fix)");
      // A rejected advance (money that never arrived) puts it back.
      await tx.payment.update({ where: { id: advance.id }, data: { isRejected: true } });
      await recomputeDue(tx, placed.orderId);
      m = await money();
      assert.equal(m.cod, start.total);
      // A COD set by hand stays — but never above what is still due.
      await tx.order.update({ where: { id: placed.orderId }, data: { codAmount: 500 } });
      await pay(100);
      assert.equal((await money()).cod, 500, "custom COD kept");
      await pay(start.total - 100 - 300);
      m = await money();
      assert.equal(m.due, 300);
      assert.equal(m.cod, 300, "custom COD capped at the due");
      // After handover the order's COD is the one handed over: a later payment doesn't move it.
      await tx.order.update({ where: { id: placed.orderId }, data: { status: "IN_TRANSIT" } });
      await pay(100);
      m = await money();
      assert.equal(m.due, 200);
      assert.equal(m.cod, 300, "in transit: left as handed over");
      // The rule itself.
      assert.equal(nextCodAmount({ codAmount: 3480, dueAmount: 3480 }, 2480), 2480);
      assert.equal(nextCodAmount({ codAmount: 0, dueAmount: 0 }, 150), 150, "fully paid, then a payment rejected");
      assert.equal(nextCodAmount({ codAmount: 0, dueAmount: 500 }, 400), 0, "COD 0 by hand (all paid by bKash later) stays 0");
      assert.equal(nextCodAmount({ codAmount: 3480, dueAmount: 3480 }, -20), 0, "overpaid → nothing to collect");
      // An order edit (the form sends the stored COD back): untouched → follows; typed → capped at the due.
      assert.equal(editedCodAmount({ submitted: 2480, before: 2480, followed: 2780, due: 2780 }), 2780, "total raised by 300, COD untouched → follows");
      assert.equal(editedCodAmount({ submitted: 3480, before: 2480, followed: 2480, due: 2480 }), 2480, "typed above the due → the due");
      assert.equal(editedCodAmount({ submitted: 1000, before: 2480, followed: 2480, due: 2480 }), 1000, "typed below → kept");
      assert.equal(editedCodAmount({ submitted: null, before: 2480, followed: 2480, due: 2200 }), 2200, "cleared → the due");
    });
  });

  test("cancel with a reason never touches order_sequences; the lead is lost with that reason", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const p = await people(tx);
      const placed = await placeWebsiteOrder(request(f, ksaPhone()), { ip: null }, tx);
      const snapshot = await tx.orderSequence.findMany({ orderBy: { yearMonth: "asc" } });
      await cancelWebsiteOrder(tx, { orderId: placed.orderId, reason: "FAKE_ORDER", userId: p.a.id });
      assert.deepEqual(await tx.orderSequence.findMany({ orderBy: { yearMonth: "asc" } }), snapshot, "order_sequences untouched");
      const o = await tx.order.findUniqueOrThrow({ where: { id: placed.orderId }, include: { lead: true } });
      assert.equal(o.status, "CANCELLED");
      assert.match(o.orderNo, /^DRAFT-/, "never got a GV number");
      assert.equal(o.cancelReason, "Website order cancelled: Fake order");
      assert.equal(o.lead?.status, "LOST");
      assert.equal(o.lead?.lostReason, "FAKE_ORDER");
      await assert.rejects(
        cancelWebsiteOrder(tx, { orderId: placed.orderId, reason: "DUPLICATE", userId: p.a.id }),
        (e) => (e as { status?: number }).status === 409
      );
      const receipt = await websiteOrderByToken(placed.token, tx);
      assert.equal(receipt?.state, "CANCELLED");
      assert.equal(receipt?.number, null, "a cancelled draft never shows its DRAFT number (Verify R3)");
      // Verify R3 — a confirmation after the cancel (e.g. racing it) can't take a number.
      await assert.rejects(confirmDraftTx(tx, placed.orderId, p.a.id, null), (e) => (e as { status?: number }).status === 400);
      assert.deepEqual(await tx.orderSequence.findMany({ orderBy: { yearMonth: "asc" } }), snapshot, "still untouched");
    });
  });

  test("the generic status control can't cancel a website draft (Verify R3): the Website panel's Cancel moves the lead to LOST", () => {
    const route = readFileSync(path.join(process.cwd(), "app/api/orders/[id]/status/route.ts"), "utf8");
    assert.match(route, /to === "CANCELLED" && order\.status === "DRAFT" && order\.source === "WEBSITE"/);
    const orders = readFileSync(path.join(process.cwd(), "lib/orders.ts"), "utf8");
    const confirm = orders.slice(orders.indexOf("export async function confirmDraftTx"));
    assert.ok(
      confirm.indexOf("FOR UPDATE") > 0 && confirm.indexOf("FOR UPDATE") < confirm.indexOf("generateOrderNumber(tx)"),
      "confirmDraftTx locks the order row before it takes a number"
    );
  });

  test("website orders count for targets only when Settings → Website says so", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const p = await people(tx);
      await checkIn(tx, p.a.id, new Date());
      await tx.user.update({ where: { id: p.b.id }, data: { isActive: false } });
      const placed = await placeWebsiteOrder(small(f, ksaPhone()), { ip: null }, tx);
      await confirmDraftTx(tx, placed.orderId, p.a.id, null);
      const month = monthKeyOf(new Date());
      assert.equal((await aggregateUserAchievement(p.a.id, month, tx)).orders, 0, "off by default");
      const existing = await tx.setting.findUnique({ where: { key: WEBSITE_SETTINGS_KEY } });
      const value = { ...((existing?.value as object | null) ?? {}), countForTargets: true };
      await tx.setting.upsert({ where: { key: WEBSITE_SETTINGS_KEY }, create: { key: WEBSITE_SETTINGS_KEY, value }, update: { value } });
      assert.equal((await aggregateUserAchievement(p.a.id, month, tx)).orders, 1);
    });
  });
});

// ---------- W-5 the private confirmation page ----------

describe("W-5 the confirmation page", () => {
  test("reference, items, money and progress — no name, phone number or address; a bad or trashed link is not found", async () => {
    await inRollback(async (tx) => {
      const f = await fixture(tx);
      const phone = ksaPhone();
      const placed = await placeWebsiteOrder(request(f, phone), { ip: null }, tx);
      const receipt = await websiteOrderByToken(placed.token, tx);
      assert.ok(receipt);
      assert.equal(receipt.ref, placed.ref);
      assert.equal(receipt.number, null, "the DRAFT number is never shown");
      assert.equal(receipt.state, "WAITING");
      assert.equal(receipt.total, 4959);
      assert.equal(receipt.items[0].choices.length, 2);
      const text = JSON.stringify(receipt);
      for (const secret of [phone, "01712345678", "Rahim", "Amma", "Dhanmondi", "Please call", "DRAFT-"]) {
        assert.ok(!text.includes(secret), `the page must not show ${secret}`);
      }
      for (const key of Object.keys(receipt)) assert.doesNotMatch(key, /phone|address|name|customer|recipient|note|ip/i);
      assert.equal(await websiteOrderByToken("short", tx), null);
      assert.equal(await websiteOrderByToken(`${placed.token.slice(0, -1)}${placed.token.endsWith("A") ? "B" : "A"}`, tx), null);
      await tx.order.update({ where: { id: placed.orderId }, data: { deletedAt: new Date() } });
      assert.equal(await websiteOrderByToken(placed.token, tx), null, "a trashed order's page is gone");
    });
  });
});
