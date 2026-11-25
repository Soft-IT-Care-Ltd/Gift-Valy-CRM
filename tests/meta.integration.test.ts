// ROUND3 W-8 — Meta Pixel + Conversions API.
// Run: npm run test:meta (needs DATABASE_URL; every database test runs inside
// ONE transaction that is rolled back; Meta is never reached — a fake
// transport records what would have been sent).
//
// The proof that no phone number or name is ever sent raw:
//   - a website order is placed with sentinel values for the sender (name,
//     WhatsApp) and the recipient (name, BD phone, address); EVERYTHING that
//     would leave for Meta — every queued event row, every request body the
//     transport receives, and the event the browser is told to fire — is
//     walked: no spelling of either phone, no name, no address appears;
//   - ph / fn / ln / country are exactly the SHA-256 of the normalised values;
//   - the browser pixel is initialised with its ID only (no advanced
//     matching) and its events carry no person data at all.
// Also: one event_id per browser + server pair; values from the database;
// Purchase once, at confirmation, with the placement's data; nothing at all
// while tracking is off.
import { test, describe, after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";

if (existsSync(".env")) process.loadEnvFile(".env");

import { prisma as appPrisma } from "../lib/db";
import { encryptSecret } from "../lib/crypto";
import { confirmDraftTx } from "../lib/orders";
import { dhakaDateBound } from "../lib/order-constants";
import { queueBrowseEvent } from "../lib/meta/events";
import { orderEventId, queueOrderLead, queuePurchase } from "../lib/meta/orders";
import { flushMetaEvents, RETRY_MINUTES, setMetaTransport, sweepConfirmedPurchases, type MetaTransport } from "../lib/meta/send";
import { loadMetaSettingsView, updateMetaSettingsTx } from "../lib/meta/settings";
import { cleanSourceUrl } from "../lib/meta/shared";
import { buildUserData, metaPhone, sha256, splitName } from "../lib/meta/user-data";
import { placeWebsiteOrder } from "../lib/storefront/place-order";
import { storefrontOrigin } from "../lib/storefront/hosts";
import { WEBSITE_SETTINGS_KEY } from "../lib/storefront/settings-shape";
import type { OrderRequestInput } from "../lib/storefront/checkout-shape";

const ROOT = path.resolve(__dirname, "..");
const prisma = new PrismaClient();
const ROLLBACK = new Error("rollback");
after(async () => {
  setMetaTransport(null);
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

// ---------- the fake Meta ----------

type Sent = { url: string; body: { data: unknown[]; access_token: string; test_event_code?: string } };
let sent: Sent[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: { events_received: 1, fbtrace_id: "T" } };
const fake: MetaTransport = async (url, body) => {
  sent.push({ url, body: body as Sent["body"] });
  return answer;
};
before(() => setMetaTransport(fake));

const PIXEL = "778899001122";
const TOKEN = "EAAGtesttoken1234567890abcdefXYZ";

async function trackingOn(tx: Tx) {
  // The privacy policy must be live before tracking can be switched on.
  const row = await tx.setting.findUnique({ where: { key: WEBSITE_SETTINGS_KEY } });
  const value = { ...((row?.value as object | null) ?? {}), policies: { delivery: "", refund: "", privacy: "We keep your data private.", terms: "" } };
  await tx.setting.upsert({ where: { key: WEBSITE_SETTINGS_KEY }, create: { key: WEBSITE_SETTINGS_KEY, value }, update: { value } });
  await tx.metaTracking.upsert({
    where: { id: "meta" },
    create: { id: "meta", isEnabled: true, pixelId: PIXEL, accessTokenEncrypted: encryptSecret(TOKEN), testEventCode: null },
    update: { isEnabled: true, pixelId: PIXEL, accessTokenEncrypted: encryptSecret(TOKEN), testEventCode: null },
  });
}

// ---------- fixture: a shown product and a package with a choice ----------

async function fixture(tx: Tx) {
  const tag = `${Date.now().toString(36)}${randomInt(1000, 9999)}`;
  const cat = await tx.category.create({ data: { name: `TEST-W8 category ${tag}` } });
  const mk = (sku: string, name: string, data: Partial<Prisma.ProductUncheckedCreateInput> = {}) =>
    tx.product.create({ data: { sku: `TEST-W8-${sku}-${tag}`, name, categoryId: cat.id, sellingPrice: 0, showOnWebsite: false, stockQty: 50, ...data } });
  const choc = await mk("CHOC", `W8 Chocolate ${tag}`, { sellingPrice: 999, showOnWebsite: true, slug: `w8-chocolate-${tag}`, deliveryChargeInsideDhaka: 60 });
  const red = await mk("RED", `W8 Red saree ${tag}`);
  const blue = await mk("BLUE", `W8 Blue saree ${tag}`);
  const hamper = await tx.package.create({
    data: {
      code: `TEST-W8-HAMPER-${tag}`,
      name: `W8 Hamper ${tag}`,
      sellingPrice: 1500,
      showOnWebsite: true,
      slug: `w8-hamper-${tag}`,
      deliveryChargeInsideDhaka: 100,
      items: {
        create: [
          { kind: "PRODUCT", productId: choc.id, qty: 1 },
          { kind: "CHOICE", choiceLabel: "Saree colour", qty: 1, options: { create: [{ productId: red.id, isDefault: true, extraPrice: 0 }, { productId: blue.id, extraPrice: 300 }] } },
        ],
      },
    },
    include: { items: true },
  });
  const gSaree = hamper.items.find((i) => i.kind === "CHOICE")!.id;
  return { tag, choc, red, blue, hamper, gSaree };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

// The sentinels: the sender abroad (who saw the ad) and the recipient in Bangladesh.
const SENDER_NAME = "Rahimsentinel Uddinsentinel";
const RECIPIENT_NAME = "Ammasentinel Begum";
const RECIPIENT_PHONE = "01799887766";
const ADDRESS = "House 77 Sentineladdress Road, Dhanmondi";
const ksaLocal = () => `5${String(randomInt(10_000_000, 99_999_999))}`;

/** 1 × Hamper (Blue, +300) + 1 Chocolate, Inside Dhaka: 1800 + 999 + 100 + 60 = ৳2959. */
function order(f: Fixture, local: string): OrderRequestInput {
  return {
    sender: { name: SENDER_NAME, country: "KSA", whatsapp: `0${local}` },
    recipient: { name: RECIPIENT_NAME, phone: RECIPIENT_PHONE, relation: "Mother", address: ADDRESS, zone: "INSIDE_DHAKA" },
    delivery: { mode: "FIXED", date: dhakaDateBound(new Date(Date.now() + 3 * 86_400_000)).toISOString().slice(0, 10) },
    occasion: "Birthday",
    note: "Notesentinel please call",
    lines: [
      { kind: "package", slug: f.hamper.slug!, picks: { [String(f.gSaree)]: f.blue.id }, qty: 1, seenPrice: 1800 },
      { kind: "product", slug: f.choc.slug!, picks: {}, qty: 1, seenPrice: 999 },
    ],
    seenTotal: 2959,
    website: "",
  };
}

/** Every string anywhere in a value. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/** No raw phone (any spelling), name, address or note anywhere in what leaves for Meta. */
function assertNothingRaw(label: string, value: unknown, local: string) {
  const forbidden = [
    local,
    `966${local}`,
    `+966${local}`,
    `0${local}`,
    RECIPIENT_PHONE,
    RECIPIENT_PHONE.slice(1),
    `88${RECIPIENT_PHONE}`,
    "Rahimsentinel",
    "Uddinsentinel",
    "rahimsentinel",
    "uddinsentinel",
    "Ammasentinel",
    "ammasentinel",
    "Sentineladdress",
    "Notesentinel",
  ];
  const text = strings(value).join("\n");
  for (const f of forbidden) assert.ok(!text.toLowerCase().includes(f.toLowerCase()), `${label} carries "${f}" raw`);
}

const hex64 = /^[0-9a-f]{64}$/;

// ---------- pure ----------

describe("W-8 user_data — hashed, the sender's only", () => {
  test("phone with its country code, digits only; names lower-case without punctuation; then SHA-256", () => {
    assert.equal(metaPhone("+966 51-234 5678"), "966512345678");
    assert.equal(metaPhone("00966512345678"), "966512345678");
    assert.equal(metaPhone("12"), null);
    assert.deepEqual(splitName("  Rahim  Uddin-Ahmed "), { first: "rahim", last: "uddinahmed" });
    assert.deepEqual(splitName("লাইলা"), { first: "লাইলা", last: null });
    const u = buildUserData({ phone: "+966512345678", name: "Rahim Uddin", country: "KSA", customerId: 42, fbp: "fb.1.1700000000000.123456789", fbc: "fb.1.1700000000000.AbCdEfGh12", ip: "203.0.113.9", userAgent: "UA" });
    assert.deepEqual(u.ph, [sha256("966512345678")]);
    assert.deepEqual(u.fn, [sha256("rahim")]);
    assert.deepEqual(u.ln, [sha256("uddin")]);
    assert.deepEqual(u.country, [sha256("sa")]);
    assert.deepEqual(u.external_id, [sha256("giftvaly-customer:42")]);
    assert.equal(u.fbp, "fb.1.1700000000000.123456789");
    assert.equal(sha256("x"), createHash("sha256").update("x").digest("hex"));
    for (const k of ["ph", "fn", "ln", "country", "external_id"] as const) assert.match(u[k]![0], hex64, k);
    // Anything that isn't Meta's own cookie is dropped.
    const junk = buildUserData({ fbp: "<script>", fbc: "fb.1.x.y" });
    assert.equal(junk.fbp, undefined);
    assert.equal(junk.fbc, undefined);
  });

  test("the browser pixel: initialised with its ID only, no advanced matching, no person data in any event", () => {
    const src = readFileSync(path.join(ROOT, "lib/storefront/meta-pixel.ts"), "utf8");
    const inits = [...src.matchAll(/fbq!?\("init",\s*([^)]*)\)/g)].map((m) => m[1].trim());
    assert.deepEqual(inits, ["pixelId"], "init(pixelId) — nothing else");
    const dataType = src.slice(src.indexOf("export type PixelData"), src.indexOf("};", src.indexOf("export type PixelData")));
    assert.doesNotMatch(dataType, /\b(ph|em|fn|ln|phone|email|name|address|external_id)\??:/, "PixelData has no person fields");
    for (const f of ["components/storefront/item-purchase.tsx", "components/storefront/checkout-form.tsx", "components/storefront/meta-pixel.tsx"]) {
      const c = readFileSync(path.join(ROOT, f), "utf8");
      assert.doesNotMatch(c, /fbq\(/, `${f} goes through lib/storefront/meta-pixel.ts`);
    }
    // No PageView on a customer's private order page or a staff preview.
    assert.match(readFileSync(path.join(ROOT, "components/storefront/meta-pixel.tsx"), "utf8"), /\(order\|preview\)/);
  });

  test("event_source_url: our website only, query dropped, the private order link never sent", () => {
    const origin = storefrontOrigin();
    assert.equal(cleanSourceUrl(`${origin}/p/cake?fbclid=x#top`), `${origin}/p/cake`);
    assert.equal(cleanSourceUrl(`${origin}/order/SeCrEtToKeN123`), `${origin}/order`);
    assert.equal(cleanSourceUrl(`${origin}/preview/home?t=abc`), `${origin}/`);
    assert.equal(cleanSourceUrl("https://evil.example/p/x", "/checkout"), `${origin}/checkout`);
  });
});

// ---------- with the database ----------

describe("W-8 nothing while tracking is off", () => {
  test("off (or no token): no Lead, no browse event, no Purchase, nothing sent", async () => {
    sent = [];
    await inRollback(async (tx) => {
      await tx.metaTracking.deleteMany({});
      const f = await fixture(tx);
      const placed = await placeWebsiteOrder(order(f, ksaLocal()), { ip: "203.0.113.20" }, tx);
      assert.equal(await queueOrderLead(tx, { orderId: placed.orderId, ip: null, userAgent: null, fbp: null, fbc: null, sourceUrl: null }), null);
      assert.equal(await queueBrowseEvent(tx, { event: "ViewContent", eventId: "viewcontent.abcdefgh", url: null, product: f.choc.slug, ip: null, userAgent: null, fbp: null, fbc: null }), null);
      await tx.metaTracking.create({ data: { id: "meta", isEnabled: true, pixelId: PIXEL, accessTokenEncrypted: null } });
      assert.equal(await queueOrderLead(tx, { orderId: placed.orderId, ip: null, userAgent: null, fbp: null, fbc: null, sourceUrl: null }), null, "no token = off");
      assert.equal(await tx.metaEvent.count({ where: { orderId: placed.orderId } }), 0);
      assert.equal(await tx.metaOrderSignal.count({ where: { orderId: placed.orderId } }), 0);
      assert.equal(await sweepConfirmedPurchases(tx), 0);
    });
    assert.equal(sent.length, 0, "Meta was never called");
  });
});

describe("W-8 Lead at placement — one event_id, value from the database, nothing raw", () => {
  test("the Lead pair, the placement capture, and what reaches Meta", async () => {
    sent = [];
    const local = ksaLocal();
    await inRollback(async (tx) => {
      await trackingOn(tx);
      const f = await fixture(tx);
      const placed = await placeWebsiteOrder(order(f, local), { ip: "203.0.113.21" }, tx);
      const lead = await queueOrderLead(tx, {
        orderId: placed.orderId,
        ip: "203.0.113.21",
        userAgent: "Mozilla/5.0 test",
        fbp: "fb.1.1764000000000.1234567890",
        fbc: "fb.1.1764000000000.IwAR0abcdefgh",
        sourceUrl: `${storefrontOrigin()}/checkout?x=1`,
      });
      assert.ok(lead, "tracking on → a Lead");
      // One event_id: what the browser fires = what the server sends.
      assert.equal(lead.browser.eventId, orderEventId(placed.ref, "lead"));
      assert.equal(lead.browser.event, "Lead");
      assert.equal(lead.browser.pixelId, PIXEL);
      const row = await tx.metaEvent.findUniqueOrThrow({ where: { orderId_eventName: { orderId: placed.orderId, eventName: "Lead" } } });
      const payload = row.payload as { event_id: string; event_name: string; user_data: Record<string, unknown>; custom_data: { value: number; currency: string; content_ids: string[]; order_id: string } };
      assert.equal(payload.event_id, lead.browser.eventId);
      assert.equal(row.eventId, lead.browser.eventId);
      // Value from the database: the order's total (2959), never the page's.
      const saved = await tx.order.findUniqueOrThrow({ where: { id: placed.orderId }, select: { totalAmount: true } });
      assert.equal(payload.custom_data.value, Number(saved.totalAmount));
      assert.equal(payload.custom_data.value, 2959);
      assert.equal(payload.custom_data.currency, "BDT");
      assert.deepEqual(payload.custom_data.content_ids.sort(), [f.choc.slug!, f.hamper.slug!].sort(), "public addresses, never SKUs");
      assert.equal(payload.custom_data.order_id, placed.ref);
      // Hashed exactly as Meta asks; the recipient never.
      assert.deepEqual(payload.user_data.ph, [sha256(`966${local}`)]);
      assert.deepEqual(payload.user_data.fn, [sha256("rahimsentinel")]);
      assert.deepEqual(payload.user_data.ln, [sha256("uddinsentinel")]);
      assert.deepEqual(payload.user_data.country, [sha256("sa")]);
      assert.equal(payload.user_data.fbc, "fb.1.1764000000000.IwAR0abcdefgh");
      assert.deepEqual(Object.keys(payload.user_data).sort(), ["client_ip_address", "client_user_agent", "country", "external_id", "fbc", "fbp", "fn", "ln", "ph"]);
      assertNothingRaw("Lead row", row.payload, local);
      assertNothingRaw("browser Lead", lead.browser, local);
      const signal = await tx.metaOrderSignal.findUniqueOrThrow({ where: { orderId: placed.orderId } });
      assertNothingRaw("placement capture", signal.userData, local);

      // Queuing twice never makes a second Lead.
      const again = await queueOrderLead(tx, { orderId: placed.orderId, ip: null, userAgent: null, fbp: null, fbc: null, sourceUrl: null });
      assert.equal(again?.eventRowId, null);
      assert.equal(await tx.metaEvent.count({ where: { orderId: placed.orderId, eventName: "Lead" } }), 1);

      // Sent: the body Meta receives.
      const result = await flushMetaEvents(tx, { ids: [row.id] });
      assert.equal(result.sent, 1);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].url, `https://graph.facebook.com/v23.0/${PIXEL}/events`);
      assert.equal(sent[0].body.access_token, TOKEN);
      assertNothingRaw("request body", sent[0].body.data, local);
      assert.equal((sent[0].body.data[0] as { event_id: string }).event_id, lead.browser.eventId);
      assert.equal((await tx.metaEvent.findUniqueOrThrow({ where: { id: row.id } })).status, "SENT");
    });
  });
});

describe("W-8 browsing events — the server prices them", () => {
  test("ViewContent / AddToCart / InitiateCheckout: the browser's event_id, the database's price, no person data", async () => {
    sent = [];
    await inRollback(async (tx) => {
      await trackingOn(tx);
      const f = await fixture(tx);
      const base = { url: `${storefrontOrigin()}/p/${f.hamper.slug}`, ip: "203.0.113.22", userAgent: "UA", fbp: null, fbc: null };
      const view = await queueBrowseEvent(tx, { ...base, event: "ViewContent", eventId: "viewcontent.a1b2c3d4e5", product: f.hamper.slug });
      const add = await queueBrowseEvent(tx, {
        ...base,
        event: "AddToCart",
        eventId: "addtocart.a1b2c3d4e5",
        items: [{ kind: "package", slug: f.hamper.slug!, picks: { [String(f.gSaree)]: f.blue.id }, qty: 2 }],
      });
      const checkout = await queueBrowseEvent(tx, {
        ...base,
        event: "InitiateCheckout",
        eventId: "initiatecheckout.a1b2c3d4e5",
        items: [
          { kind: "package", slug: f.hamper.slug!, picks: { [String(f.gSaree)]: f.blue.id }, qty: 1 },
          { kind: "product", slug: f.choc.slug!, picks: {}, qty: 3 },
        ],
      });
      const gone = await queueBrowseEvent(tx, { ...base, event: "ViewContent", eventId: "viewcontent.zzzzzzzzzz", product: "no-such-gift" });
      assert.equal(gone, null, "not on the website → nothing");
      const rows = await tx.metaEvent.findMany({ where: { id: { in: [view!, add!, checkout!] } }, orderBy: { id: "asc" } });
      const data = rows.map((r) => r.payload as { event_id: string; user_data: object; custom_data: { value: number } });
      assert.deepEqual(data.map((d) => d.event_id), ["viewcontent.a1b2c3d4e5", "addtocart.a1b2c3d4e5", "initiatecheckout.a1b2c3d4e5"]);
      assert.equal(data[0].custom_data.value, 1500, "the package's starting price");
      assert.equal(data[1].custom_data.value, 3600, "2 × (1500 + 300 for Blue)");
      assert.equal(data[2].custom_data.value, 1800 + 3 * 999);
      for (const d of data) assert.deepEqual(Object.keys(d.user_data).sort(), ["client_ip_address", "client_user_agent"], "browsing carries no phone, no name");
    });
  });
});

describe("W-8 Purchase at confirmation — once, server only, with the placement's data", () => {
  test("confirmDraftTx queues it; a second try is a no-op; a staff order gets none; the sweep catches a missed one", async () => {
    sent = [];
    const local = ksaLocal();
    await inRollback(async (tx) => {
      await trackingOn(tx);
      const f = await fixture(tx);
      const se = await tx.user.findFirstOrThrow({ where: { role: { name: "Admin" } }, select: { id: true } });
      const placed = await placeWebsiteOrder(order(f, local), { ip: "203.0.113.23" }, tx);
      await queueOrderLead(tx, { orderId: placed.orderId, ip: "203.0.113.23", userAgent: "UA", fbp: null, fbc: null, sourceUrl: null });
      const signal = await tx.metaOrderSignal.findUniqueOrThrow({ where: { orderId: placed.orderId } });

      await confirmDraftTx(tx, placed.orderId, se.id, "Advance received");
      const purchase = await tx.metaEvent.findUniqueOrThrow({ where: { orderId_eventName: { orderId: placed.orderId, eventName: "Purchase" } } });
      const p = purchase.payload as { event_id: string; event_time: number; user_data: unknown; custom_data: { value: number } };
      assert.equal(p.event_id, orderEventId(placed.ref, "purchase"));
      assert.equal(p.event_time, Math.floor(signal.placedAt.getTime() / 1000), "the placement time");
      assert.deepEqual(p.user_data, signal.userData, "what was captured at placement");
      assert.equal(p.custom_data.value, 2959);
      assertNothingRaw("Purchase", purchase.payload, local);
      assert.equal(await queuePurchase(tx, placed.orderId), "exists");
      assert.equal(await sweepConfirmedPurchases(tx), 0);
      assert.equal(await tx.metaEvent.count({ where: { orderId: placed.orderId, eventName: "Purchase" } }), 1, "once per order");

      // A missed Purchase (tracking was off at confirmation) is swept up once tracking is on.
      const second = await placeWebsiteOrder(order(f, ksaLocal()), { ip: "203.0.113.24" }, tx);
      await queueOrderLead(tx, { orderId: second.orderId, ip: null, userAgent: null, fbp: null, fbc: null, sourceUrl: null });
      await tx.metaTracking.update({ where: { id: "meta" }, data: { isEnabled: false } });
      await confirmDraftTx(tx, second.orderId, se.id, null);
      assert.equal(await tx.metaEvent.count({ where: { orderId: second.orderId, eventName: "Purchase" } }), 0, "off → none");
      await tx.metaTracking.update({ where: { id: "meta" }, data: { isEnabled: true } });
      assert.equal(await sweepConfirmedPurchases(tx), 1);
      assert.equal(await tx.metaEvent.count({ where: { orderId: second.orderId, eventName: "Purchase" } }), 1);
    });
  });
});

describe("W-8 sending — retries, then Failed; switched off → never sent later", () => {
  test("Meta refusing: retried with growing gaps, then Failed; the token never stored in the answer", async () => {
    sent = [];
    await inRollback(async (tx) => {
      await trackingOn(tx);
      const f = await fixture(tx);
      const id = await queueBrowseEvent(tx, { event: "ViewContent", eventId: "viewcontent.retrytest1", url: null, product: f.choc.slug, ip: null, userAgent: null, fbp: null, fbc: null });
      answer = { status: 400, body: { error: { message: "Invalid parameter", code: 100 } } };
      let now = new Date();
      for (let i = 0; i < RETRY_MINUTES.length; i++) {
        await flushMetaEvents(tx, { ids: [id!], now });
        const row = await tx.metaEvent.findUniqueOrThrow({ where: { id: id! } });
        assert.equal(row.status, "PENDING");
        assert.equal(row.nextAttemptAt!.getTime(), now.getTime() + RETRY_MINUTES[i] * 60_000);
        assert.match(row.error ?? "", /Invalid parameter \(code 100\)/);
        now = new Date(row.nextAttemptAt!.getTime() + 1000);
      }
      await flushMetaEvents(tx, { ids: [id!], now });
      const failed = await tx.metaEvent.findUniqueOrThrow({ where: { id: id! } });
      assert.equal(failed.status, "FAILED");
      assert.ok(!JSON.stringify(failed.response).includes(TOKEN));

      const waiting = await queueBrowseEvent(tx, { event: "PageView", eventId: "pageview.offlater1", url: null, ip: null, userAgent: null, fbp: null, fbc: null });
      await tx.metaTracking.update({ where: { id: "meta" }, data: { isEnabled: false } });
      const r = await flushMetaEvents(tx, { ids: [waiting!] });
      assert.equal(r.skipped, 1);
      assert.equal((await tx.metaEvent.findUniqueOrThrow({ where: { id: waiting! } })).status, "SKIPPED");
    });
    answer = { status: 200, body: { events_received: 1 } };
  });
});

describe("W-8 Settings → Website → Meta Pixel", () => {
  test("the token is stored encrypted, never returned or audited; tracking needs the ID, the token and the privacy policy", async () => {
    await inRollback(async (tx) => {
      const admin = await tx.user.findFirstOrThrow({ where: { role: { name: "Admin" } }, select: { id: true } });
      await tx.metaTracking.deleteMany({});
      const value = { policies: { delivery: "", refund: "", privacy: "", terms: "" } };
      await tx.setting.upsert({ where: { key: WEBSITE_SETTINGS_KEY }, create: { key: WEBSITE_SETTINGS_KEY, value }, update: { value } });

      await assert.rejects(updateMetaSettingsTx(tx, { pixelId: PIXEL, isEnabled: true }, admin.id), /Pixel ID and the Conversions API token/);
      const view = await updateMetaSettingsTx(tx, { pixelId: PIXEL, accessToken: TOKEN }, admin.id);
      assert.equal(view.hasToken, true);
      assert.equal(view.tokenMasked, "****…XYZ");
      assert.ok(!JSON.stringify(view).includes(TOKEN));
      const row = await tx.metaTracking.findUniqueOrThrow({ where: { id: "meta" } });
      assert.ok(row.accessTokenEncrypted && !row.accessTokenEncrypted.includes(TOKEN), "encrypted at rest");
      await assert.rejects(updateMetaSettingsTx(tx, { isEnabled: true }, admin.id), /privacy policy/);
      await tx.setting.update({ where: { key: WEBSITE_SETTINGS_KEY }, data: { value: { policies: { delivery: "", refund: "", privacy: "Private.", terms: "" } } } });
      const on = await updateMetaSettingsTx(tx, { isEnabled: true }, admin.id);
      assert.equal(on.isEnabled, true, "switching on needs no re-typed token");
      const audits = await tx.auditLog.findMany({ where: { action: "settings.website.meta", userId: admin.id } });
      assert.ok(audits.length >= 2);
      for (const a of audits) assert.ok(!JSON.stringify([a.beforeJson, a.afterJson]).includes(TOKEN), "the token is never in the audit log");
      assert.equal((await loadMetaSettingsView(tx)).privacyLive, true);
      await assert.rejects(updateMetaSettingsTx(tx, { pixelId: "abc" }, admin.id));
    });
  });
});
