// ROUND3 W-7 — Settings → Website and the home page manager.
// Run: npm run test:website-home (needs DATABASE_URL; every database test
// runs inside ONE transaction that is rolled back).
//
// 1. Settings → Website: what the owner types becomes what the website reads
//    (WhatsApp 8801…, Messenger username, templates with only their own
//    placeholders, no half-finished [[…]] policy, limits in range); the order
//    rules stay out of what the website receives; the save is audited; the
//    privacy policy can't be emptied while Meta tracking is on.
// 2. The home page layout: banners need a desktop AND a mobile photo (or the
//    placeholder), safe links only, end after start.
// 3. The home page manager: a draft changes nothing on the website; publish
//    makes the draft what getHomeLayout("published") returns, audited; discard
//    goes back; the signed preview link expires and can't be forged.
// 4. buildHomeView: switched-off sections and ended banners are left out.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { PrismaClient, type Prisma } from "@prisma/client";

if (existsSync(".env")) process.loadEnvFile(".env");

import { prisma as appPrisma } from "../lib/db";
import { uploadPath, uploadRoot } from "../lib/file-storage";
import { DEFAULT_HOME_LAYOUT, homeLayoutSchema, isSafeLink, newBanner, type HomeLayout } from "../lib/home-page/layout";
import { makePreviewToken, PREVIEW_TTL_MS, verifyPreviewToken } from "../lib/home-page/preview-token";
import { discardHomeDraft, getHomeEditorState, publishHomePageTx, saveHomeDraft } from "../lib/home-page/service";
import { getHomeLayout } from "../lib/storefront/catalog";
import { buildHomeView } from "../lib/storefront/home-data";
import { shopMessengerPage, shopWhatsApp, websiteSettingsForm, websiteSettingsSchema } from "../lib/storefront/settings-form";
import { DEFAULT_ORDER_MESSAGE, normalizeWebOrderRules, normalizeWebSettings, WEBSITE_SETTINGS_KEY } from "../lib/storefront/settings-shape";
import { readWebsiteSettingsForm, saveWebsiteSettingsTx } from "../lib/website-settings";

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
      { timeout: 120_000, maxWait: 20_000 }
    ),
    (e) => {
      if (e === ROLLBACK) return true;
      throw e;
    }
  );
}

const staffId = async (tx: Tx) => (await tx.user.findFirstOrThrow({ where: { role: { name: "Admin" } }, select: { id: true } })).id;

/** A complete, valid form (what the Settings screen sends). */
function form(over: Record<string, unknown> = {}) {
  return {
    ...websiteSettingsForm(null),
    whatsapp: "০১৭১১-২২৩৩৪৪",
    messengerPage: "https://m.me/giftvaly",
    hotline: "+880 1711-223344",
    facebookUrl: "https://facebook.com/giftvaly",
    officeAddress: "House 1, Road 2, Dhanmondi",
    deliveryTimes: { insideDhaka: "Same day", subDhaka: "1 day", outsideDhaka: "2–3 days" },
    policies: { delivery: "We deliver in 1–3 days.", refund: "", privacy: "We keep your number private.", terms: "" },
    orderLimits: { phonePerHour: 4, ipPerHour: 25 },
    countForTargets: true,
    ...over,
  };
}

const issuesOf = (raw: unknown) => {
  const r = websiteSettingsSchema.safeParse(raw);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("W-7 Settings → Website — what the owner types", () => {
  test("the shop's WhatsApp, any spelling → 8801XXXXXXXXX; not a BD mobile → refused; empty = no button", () => {
    for (const typed of ["01711223344", "01711-223344", "+880 1711 223344", "8801711223344", "1711223344", "০১৭১১২২৩৩৪৪"]) {
      assert.equal(shopWhatsApp(typed), "8801711223344", typed);
    }
    assert.equal(shopWhatsApp(""), "");
    for (const bad of ["0171122334", "01211223344", "+966512345678", "hello"]) assert.equal(shopWhatsApp(bad), null, bad);
  });

  test("Messenger: a username or any m.me / facebook.com link → the username", () => {
    assert.equal(shopMessengerPage("giftvaly"), "giftvaly");
    assert.equal(shopMessengerPage("@giftvaly"), "giftvaly");
    assert.equal(shopMessengerPage("https://m.me/giftvaly"), "giftvaly");
    assert.equal(shopMessengerPage("m.me/giftvaly?ref=x"), "giftvaly");
    assert.equal(shopMessengerPage("https://www.facebook.com/giftvaly/"), "giftvaly");
    assert.equal(shopMessengerPage("https://facebook.com/profile.php?id=100089123456789"), "100089123456789");
    assert.equal(shopMessengerPage(""), "");
    assert.equal(shopMessengerPage("not a page!"), null);
  });

  test("a template may use only its own placeholders; a policy with [[…]] is refused; limits in range", () => {
    assert.deepEqual(issuesOf(form()), {});
    const e1 = issuesOf(form({ productMessage: "Hi {product} {colour}" }));
    assert.match(e1.productMessage, /\{colour\}/);
    const e2 = issuesOf(form({ productMessage: "About {order_ref}" }));
    assert.match(e2.productMessage, /\{order_ref\}/, "an order placeholder isn't a product one");
    const e3 = issuesOf(form({ orderMessage: "Order {order_ref} — {price}" }));
    assert.match(e3.orderMessage, /\{price\}/);
    assert.ok(issuesOf(form({ orderMessage: "" })).orderMessage, "a message can't be empty");
    assert.ok(issuesOf(form({ policies: { delivery: "Within [[N]] days", refund: "", privacy: "", terms: "" } }))["policies.delivery"]);
    assert.ok(issuesOf(form({ orderLimits: { phonePerHour: 0, ipPerHour: 20 } }))["orderLimits.phonePerHour"]);
    assert.ok(issuesOf(form({ orderLimits: { phonePerHour: 5, ipPerHour: 5000 } }))["orderLimits.ipPerHour"]);
    assert.ok(issuesOf(form({ facebookUrl: "javascript:alert(1)" })).facebookUrl);
    assert.ok(issuesOf(form({ whatsapp: "12345" })).whatsapp);
  });

  test("a missing row: website on, default messages, no buttons, order rules at their defaults", () => {
    const s = normalizeWebSettings(null);
    assert.equal(s.websiteOn, true);
    assert.equal(s.orderMessage, DEFAULT_ORDER_MESSAGE);
    assert.deepEqual(s.homeSeo, { title: "", description: "" });
    assert.equal(normalizeWebSettings({ websiteOn: false }).websiteOn, false);
    assert.equal(normalizeWebSettings({ websiteOn: "no" }).websiteOn, true, "only false switches it off");
  });

  test("the save: stored as the website reads it, audited, the order rules never in the public settings", async () => {
    await inRollback(async (tx) => {
      const userId = await staffId(tx);
      const saved = await saveWebsiteSettingsTx(tx, form(), userId);
      assert.equal(saved.whatsapp, "8801711223344");
      assert.equal(saved.messengerPage, "giftvaly");
      const row = await tx.setting.findUniqueOrThrow({ where: { key: WEBSITE_SETTINGS_KEY } });
      const pub = normalizeWebSettings(row.value);
      assert.equal(pub.whatsapp, "8801711223344");
      assert.equal(pub.deliveryTimes.insideDhaka, "Same day");
      assert.equal(pub.policies.privacy, "We keep your number private.");
      assert.ok(!("orderLimits" in pub) && !("countForTargets" in pub), "the website never receives the order rules");
      // W-5 / W-6 read the rules from the same row.
      assert.deepEqual(normalizeWebOrderRules(row.value), { phonePerHour: 4, ipPerHour: 25, countForTargets: true });
      assert.deepEqual(await readWebsiteSettingsForm(tx), saved);
      const audit = await tx.auditLog.findFirst({ where: { action: "settings.website", userId }, orderBy: { id: "desc" } });
      assert.ok(audit?.beforeJson && audit.afterJson, "before and after");
      await assert.rejects(saveWebsiteSettingsTx(tx, form({ whatsapp: "123" }), userId));
    });
  });

  test("the privacy policy can't be emptied while Meta tracking is on", async () => {
    await inRollback(async (tx) => {
      const userId = await staffId(tx);
      await saveWebsiteSettingsTx(tx, form(), userId);
      await tx.metaTracking.upsert({ where: { id: "meta" }, create: { id: "meta", isEnabled: true, pixelId: "1234567890" }, update: { isEnabled: true } });
      await assert.rejects(
        saveWebsiteSettingsTx(tx, form({ policies: { delivery: "", refund: "", privacy: "", terms: "" } }), userId),
        /switch tracking off first/
      );
    });
  });
});

// ---------- the home page ----------

const BANNER_FILE = () => `banner-${randomUUID()}.webp`;
const photo = (file: string, w: number, h: number) => ({ file, width: w, height: h });

describe("W-7 the home page layout", () => {
  test("a banner needs a desktop and a mobile photo — or the placeholder; it ends after it starts", () => {
    const parse = (b: object) => homeLayoutSchema.safeParse({ version: 1, sections: [{ id: "banners", kind: "banners", enabled: true, items: [b] }] });
    const base = { ...newBanner("b1"), text: "Eid gifts" };
    assert.ok(parse(base).success, "placeholder alone is fine");
    assert.ok(!parse({ ...base, placeholder: false, desktop: photo(BANNER_FILE(), 1920, 700) }).success, "mobile missing");
    assert.ok(parse({ ...base, placeholder: false, desktop: photo(BANNER_FILE(), 1920, 700), mobile: photo(BANNER_FILE(), 1080, 1350) }).success);
    assert.ok(!parse({ ...base, startsAt: "2026-12-10T10:00", endsAt: "2026-12-10T09:00" }).success, "ends before it starts");
    assert.ok(!parse({ ...base, text: "" }).success, "a banner says something");
    assert.ok(!parse({ ...base, placeholder: false, desktop: photo("../../etc/passwd", 1, 1), mobile: photo(BANNER_FILE(), 1080, 1350) }).success, "only uploaded banner files");
  });

  test("links stay on the website or go to https; two sections can't share an id; at most 8 banners", () => {
    for (const ok of ["", "/c/birthday", "/p/eid-hamper", "/search?q=cake", "#all", "https://facebook.com/giftvaly"]) assert.ok(isSafeLink(ok), ok);
    for (const bad of ["javascript:alert(1)", "//evil.example", "http://plain.example", "/../uploads/x", "data:text/html,x"]) assert.ok(!isSafeLink(bad), bad);
    const twice = { version: 1, sections: [DEFAULT_HOME_LAYOUT.sections[1], DEFAULT_HOME_LAYOUT.sections[1]] };
    assert.ok(!homeLayoutSchema.safeParse(twice).success);
    const nine = { version: 1, sections: [{ id: "banners", kind: "banners", enabled: true, items: Array.from({ length: 9 }, (_, i) => ({ ...newBanner(`b${i}`), text: "x" })) }] };
    assert.ok(!homeLayoutSchema.safeParse(nine).success);
    assert.ok(homeLayoutSchema.safeParse(DEFAULT_HOME_LAYOUT).success, "the starting layout is valid");
  });

  test("the signed preview link: valid for two hours, never forged, never stretched", () => {
    const now = Date.now();
    const t = makePreviewToken(now);
    assert.ok(verifyPreviewToken(t, now));
    assert.ok(verifyPreviewToken(t, now + PREVIEW_TTL_MS - 1000));
    assert.ok(!verifyPreviewToken(t, now + PREVIEW_TTL_MS + 1000), "expired");
    const [exp, sig] = t.split(".");
    assert.ok(!verifyPreviewToken(`${Number(exp) + 3_600_000}.${sig}`, now), "a moved expiry breaks the signature");
    assert.ok(!verifyPreviewToken(`${exp}.${sig.slice(0, -2)}xx`, now));
    assert.ok(!verifyPreviewToken(null, now));
    assert.ok(!verifyPreviewToken("garbage", now));
  });
});

describe("W-7 the home page manager — draft, publish, discard", () => {
  test("a draft changes nothing on the website; publish does (audited); discard goes back", async () => {
    const file = BANNER_FILE();
    await mkdir(uploadRoot(), { recursive: true });
    await writeFile(uploadPath(file)!, Buffer.from("webp"));
    try {
      await inRollback(async (tx) => {
        const userId = await staffId(tx);
        await tx.homePage.deleteMany({ where: { id: "home" } });
        const before = await getHomeLayout("published", tx);
        assert.deepEqual(before, DEFAULT_HOME_LAYOUT, "never published = the starting layout");

        const layout: HomeLayout = {
          version: 1,
          sections: [
            {
              id: "banners",
              kind: "banners",
              enabled: true,
              items: [{ ...newBanner("eid"), text: "Eid gifts", placeholder: false, desktop: photo(file, 1920, 700), mobile: photo(file, 1080, 1350), link: "/c/eid" }],
            },
            { id: "note", kind: "text", enabled: true, title: "Free card", body: "Every gift comes with a **free** card.", buttonLabel: "", buttonLink: "" },
            { id: "all", kind: "all", enabled: true, title: "", count: 8 },
          ],
        };
        const state = await saveHomeDraft(layout, userId, tx);
        assert.equal(state.unpublished, true);
        assert.deepEqual(await getHomeLayout("published", tx), DEFAULT_HOME_LAYOUT, "the draft isn't on the website");
        assert.deepEqual(await getHomeLayout("draft", tx), layout, "the preview shows the draft");

        await publishHomePageTx(tx, userId);
        assert.deepEqual(await getHomeLayout("published", tx), layout, "published");
        assert.equal((await getHomeEditorState(tx)).unpublished, false);
        const audit = await tx.auditLog.findFirst({ where: { action: "website.home.publish", userId }, orderBy: { id: "desc" } });
        assert.ok(audit?.afterJson, "audited with what was published");

        await saveHomeDraft({ ...layout, sections: layout.sections.slice(1) }, userId, tx);
        assert.equal((await getHomeEditorState(tx)).unpublished, true);
        const back = await discardHomeDraft(userId, tx);
        assert.deepEqual(back.draft, layout, "discard = what the website shows");
        assert.equal(back.unpublished, false);

        // A banner photo that was never uploaded, a category that doesn't exist → refused.
        const missing = structuredClone(layout);
        (missing.sections[0] as Extract<HomeLayout["sections"][number], { kind: "banners" }>).items[0].mobile = photo(BANNER_FILE(), 1080, 1350);
        await assert.rejects(saveHomeDraft(missing, userId, tx), /banner photo is missing/);
        await assert.rejects(
          saveHomeDraft({ version: 1, sections: [{ id: "c", kind: "categories", enabled: true, title: "", mode: "HAND", categoryIds: [2_000_000_000] }] }, userId, tx),
          /category no longer exists/
        );
        await assert.rejects(saveHomeDraft({ version: 1, sections: [{ id: "x", kind: "nope" }] }, userId, tx));
      });
    } finally {
      await unlink(uploadPath(file)!).catch(() => {});
    }
  });

  test("buildHomeView: switched-off sections and ended banners are left out; times go out as moments", async () => {
    await inRollback(async (tx) => {
      const now = new Date("2026-12-01T06:00:00Z"); // 12:00 Dhaka
      const file = BANNER_FILE();
      const layout: HomeLayout = {
        version: 1,
        sections: [
          {
            id: "banners",
            kind: "banners",
            enabled: true,
            items: [
              { ...newBanner("over"), text: "Ended", endsAt: "2026-12-01T11:00" },
              { ...newBanner("later"), text: "Later today", startsAt: "2026-12-01T18:00", endsAt: "2026-12-02T00:00" },
              { ...newBanner("off"), text: "Switched off", enabled: false },
              { ...newBanner("photo"), text: "Photo", placeholder: false, desktop: photo(file, 1920, 700), mobile: photo(file, 1080, 1350) },
            ],
          },
          { id: "hidden-text", kind: "text", enabled: false, title: "Hidden", body: "x", buttonLabel: "", buttonLink: "" },
          { id: "empty-text", kind: "text", enabled: true, title: "", body: "", buttonLabel: "", buttonLink: "" },
          { id: "promises", kind: "promises", enabled: true },
        ],
      };
      const view = await buildHomeView(layout, tx, now);
      assert.deepEqual(view.blocks.map((b) => b.key), ["banners", "promises"]);
      const banners = view.blocks[0];
      assert.ok(banners.kind === "banners");
      assert.deepEqual(banners.items.map((b) => b.key), ["later", "photo"], "the slider re-checks start times itself");
      assert.equal(banners.items[0].startsAt, "2026-12-01T12:00:00.000Z", "18:00 Dhaka");
      const p = banners.items[1];
      assert.equal(p.desktop?.src, `/img/${file.replace(".webp", "")}-1600.webp`);
      assert.match(p.mobile?.srcSet ?? "", /-720\.webp 720w, .*-1080\.webp 1080w$/);
      assert.equal(view.builtAt, now.toISOString());
    });
  });
});
