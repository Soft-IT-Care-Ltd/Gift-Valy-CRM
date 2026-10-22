// FUNNEL_LINER.md GV-2…GV-6 — the Funnel Liner connector, without a database:
// the secret (401 cases for every route), Zod refusals, phone normalisation,
// the shared sign-in match, addresses, cookie names and the /go/ + /_c/ rule.
// The database side is tests/platform.integration.test.ts.
// Run: npm run test:platform
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  billingHandler,
  hasUserHandler,
  stateHandler,
  usageHandler,
} from "../lib/platform/handlers";
import type { Db } from "../lib/platform/tx";
import { normalizeUserPhone, userPhoneSpellings } from "../lib/user-phone";
import { signInUserWhere } from "../lib/sign-in-user";
import { instanceUrl, steadfastCallbackUrl } from "../lib/platform/addresses";
import {
  billingSnapshotSchema,
  isNewerPush,
  parseStoredBilling,
  parseStoredState,
  platformPushSchema,
} from "../lib/platform/state-shape";
import { validSnapshot } from "./fixtures/platform";
import { usageRange, yearMonthsBetween, previousYearMonth } from "../lib/platform/usage";

const ROOT = path.resolve(__dirname, "..");
const PLATFORM = "plat-secret-123";
const CRON = "cron-secret-456";

// A database that fails the test if anything reaches it: a refused request
// must be refused before any query.
const NO_DB = new Proxy({}, {
  get() {
    throw new Error("the database was touched before the secret was checked");
  },
}) as unknown as Db;

const req = (method: "GET" | "POST", url: string, auth?: string, body?: unknown) =>
  new Request(`http://localhost:3000${url}`, {
    method,
    headers: { ...(auth !== undefined ? { authorization: auth } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

const ROUTES = [
  { name: "usage", method: "GET" as const, url: "/api/platform/usage", handler: usageHandler, body: undefined },
  { name: "state", method: "POST" as const, url: "/api/platform/state", handler: stateHandler, body: { state: "active", sentAt: "2026-11-01T01:00:00+06:00" } },
  { name: "billing", method: "POST" as const, url: "/api/platform/billing", handler: billingHandler, body: { sentAt: "2026-11-01T01:00:00+06:00" } },
  { name: "has-user", method: "POST" as const, url: "/api/platform/has-user", handler: hasUserHandler, body: { identifier: "01712345678" } },
];

describe("PLATFORM_SECRET — every route answers 401 and never touches the database", () => {
  beforeEach(() => {
    process.env.PLATFORM_SECRET = PLATFORM;
    process.env.CRON_SECRET = CRON;
  });

  for (const r of ROUTES) {
    test(`${r.name}: no header`, async () => {
      const res = await r.handler(req(r.method, r.url, undefined, r.body), NO_DB);
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: "Unauthorized" });
      assert.equal(res.headers.get("cache-control"), "no-store");
    });
    test(`${r.name}: wrong secret`, async () => {
      const res = await r.handler(req(r.method, r.url, "Bearer nope", r.body), NO_DB);
      assert.equal(res.status, 401);
    });
    test(`${r.name}: the secret without "Bearer "`, async () => {
      const res = await r.handler(req(r.method, r.url, PLATFORM, r.body), NO_DB);
      assert.equal(res.status, 401);
    });
    test(`${r.name}: CRON_SECRET is refused`, async () => {
      const res = await r.handler(req(r.method, r.url, `Bearer ${CRON}`, r.body), NO_DB);
      assert.equal(res.status, 401);
    });
    test(`${r.name}: fails closed when PLATFORM_SECRET was set to CRON_SECRET`, async () => {
      const saved = process.env.PLATFORM_SECRET;
      process.env.PLATFORM_SECRET = CRON;
      try {
        const res = await r.handler(req(r.method, r.url, `Bearer ${CRON}`, r.body), NO_DB);
        assert.equal(res.status, 401);
      } finally {
        process.env.PLATFORM_SECRET = saved;
      }
    });
    test(`${r.name}: fails closed with PLATFORM_SECRET unset or blank`, async () => {
      delete process.env.PLATFORM_SECRET;
      for (const auth of ["Bearer ", "Bearer undefined", "Bearer"]) {
        const res = await r.handler(req(r.method, r.url, auth, r.body), NO_DB);
        assert.equal(res.status, 401);
      }
      process.env.PLATFORM_SECRET = "   ";
      const res = await r.handler(req(r.method, r.url, "Bearer    ", r.body), NO_DB);
      assert.equal(res.status, 401);
    });
  }

  test("the route files only bind the handlers (the secret check can't be skipped)", () => {
    for (const r of ROUTES) {
      const src = readFileSync(path.join(ROOT, `app/api/platform/${r.name}/route.ts`), "utf8");
      assert.match(src, new RegExp(`return ${r.handler.name}\\(req\\);`), r.name);
    }
  });
});

describe("Zod — malformed requests are refused with 400 before the database", () => {
  beforeEach(() => {
    process.env.PLATFORM_SECRET = PLATFORM;
  });
  const auth = `Bearer ${PLATFORM}`;

  test("usage: bad YYMM, from after to, more than 36 months", async () => {
    for (const q of ["?from=2613", "?to=26-10", "?from=2611&to=2610", "?from=2001&to=2610"]) {
      const res = await usageHandler(req("GET", `/api/platform/usage${q}`, auth), NO_DB);
      assert.equal(res.status, 400, q);
    }
  });

  test("state: not JSON, unknown state, missing sentAt, bad dueOn", async () => {
    const bodies = [
      "{not json",
      { state: "closed", sentAt: "2026-11-01T01:00:00+06:00" },
      { state: "active" },
      { state: "past_due", dueOn: "7 Nov", sentAt: "2026-11-01T01:00:00+06:00" },
      { state: "active", sentAt: "yesterday" },
    ];
    for (const b of bodies) {
      const res = await stateHandler(req("POST", "/api/platform/state", auth, b), NO_DB);
      assert.equal(res.status, 400, JSON.stringify(b));
    }
  });

  test("billing: not JSON, non-integer paisa, 13 invoices, bad period", async () => {
    const ok = validSnapshot();
    const bodies: unknown[] = [
      "{",
      { ...ok, plan: { ...ok.plan, fixedFeePaisa: 2900.5 } },
      { ...ok, invoices: Array.from({ length: 13 }, () => ok.invoices[0]) },
      { ...ok, invoices: [{ ...ok.invoices[0], period: "2613" }] },
      { ...ok, invoices: [{ ...ok.invoices[0], totalPaisa: -1 }] },
    ];
    for (const b of bodies) {
      const res = await billingHandler(req("POST", "/api/platform/billing", auth, b), NO_DB);
      assert.equal(res.status, 400);
    }
  });

  test("has-user: missing or empty identifier", async () => {
    for (const b of [{}, { identifier: "" }, { identifier: "   " }, { phone: "01712345678" }]) {
      const res = await hasUserHandler(req("POST", "/api/platform/has-user", auth, b), NO_DB);
      assert.equal(res.status, 400);
    }
  });

  test("has-user: an identifier that is neither phone nor email is found:false without a query", async () => {
    const res = await hasUserHandler(req("POST", "/api/platform/has-user", auth, { identifier: "hello" }), NO_DB);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { found: false });
  });
});

describe("shapes", () => {
  test("the FUNNEL_LINER_ADMIN.md §8 example parses", () => {
    assert.equal(billingSnapshotSchema.safeParse(validSnapshot()).success, true);
    assert.deepEqual(parseStoredBilling(validSnapshot())?.invoices[0].number, "FL-2611-0001");
    assert.equal(parseStoredBilling(null), null);
    assert.equal(parseStoredBilling({ junk: 1 }), null);
  });
  test("a state push parses; stored garbage reads as active", () => {
    assert.equal(
      platformPushSchema.safeParse({ state: "past_due", amountDue: "৳3,800", dueOn: "2026-11-07", sentAt: "2026-11-01T01:00:00+06:00" }).success,
      true
    );
    assert.equal(parseStoredState(null).state, "active");
    assert.equal(parseStoredState({ state: "suspended" }).state, "active");
    assert.equal(parseStoredState("x").state, "active");
  });
  test("an older push is not newer; the same instant in another zone is", () => {
    assert.equal(isNewerPush(null, "2026-11-01T00:00:00Z"), true);
    assert.equal(isNewerPush("2026-11-02T00:00:00.000Z", "2026-11-01T00:00:00Z"), false);
    assert.equal(isNewerPush("2026-11-01T00:00:00.000Z", "2026-11-01T06:00:00+06:00"), true);
  });
  test("usage range defaults to the previous and the current Dhaka month", () => {
    // 2026-10-31 20:00 UTC is already 1 Nov in Dhaka.
    assert.deepEqual(usageRange({}, new Date("2026-10-31T20:00:00Z")), { from: "2610", to: "2611" });
    assert.deepEqual(usageRange({ to: "2601" }), { from: "2512", to: "2601" });
    assert.equal(previousYearMonth("2601"), "2512");
    assert.deepEqual(yearMonthsBetween("2611", "2702"), ["2611", "2612", "2701", "2702"]);
  });
});

describe("GV-5 phone normalisation and the shared sign-in match", () => {
  test("every spelling of a BD mobile becomes 01XXXXXXXXX", () => {
    for (const raw of ["01712345678", "+8801712345678", "8801712345678", "008801712345678", "+880 1712-345678", " 017 1234 5678 "]) {
      assert.equal(normalizeUserPhone(raw), "01712345678", raw);
    }
  });
  test("foreign numbers keep their country code; junk is null", () => {
    assert.equal(normalizeUserPhone("+966 55 123 4567"), "+966551234567");
    assert.equal(normalizeUserPhone("00966551234567"), "+966551234567");
    for (const raw of ["", null, undefined, "abc", "1234", "0171234567", "01212345678", "0123456789012345"]) {
      assert.equal(normalizeUserPhone(raw), null, String(raw));
    }
  });
  test("signInUserWhere: email any case, phone any spelling, active users only", () => {
    assert.deepEqual(signInUserWhere(" Admin@GiftValy.com "), {
      isActive: true,
      email: { equals: "admin@giftvaly.com", mode: "insensitive" },
    });
    // A phone saved as +8801…, 8801… or 01… is found by 01XXXXXXXXX (what the shared sign-in page sends).
    assert.deepEqual(signInUserWhere("01712345678"), {
      isActive: true,
      phone: { in: ["01712345678", "+8801712345678", "8801712345678", "008801712345678"] },
    });
    assert.deepEqual(userPhoneSpellings("+966551234567"), ["+966551234567", "966551234567", "00966551234567"]);
    assert.equal(signInUserWhere("not a phone"), null);
    assert.equal(signInUserWhere("  "), null);
  });
  test("lib/auth.ts and has-user share the one match", () => {
    const auth = readFileSync(path.join(ROOT, "lib/auth.ts"), "utf8");
    const handlers = readFileSync(path.join(ROOT, "lib/platform/handlers.ts"), "utf8");
    assert.match(auth, /signInUserWhere\(credentials\.identifier\)/);
    assert.match(handlers, /signInUserWhere\(parsed\.data\.identifier\)/);
  });
});

describe("GV-5 session cookie names are Gift Valy's own", () => {
  test("over https: __Secure-gv.* / __Host-gv.*; never next-auth.*", async () => {
    process.env.NEXTAUTH_URL = "https://dashboard.funnelliner.com";
    const { authOptions } = await import("../lib/auth");
    const c = authOptions.cookies!;
    assert.equal(c.sessionToken!.name, "__Secure-gv.session-token");
    assert.equal(c.callbackUrl!.name, "__Secure-gv.callback-url");
    assert.equal(c.csrfToken!.name, "__Host-gv.csrf-token");
    for (const k of ["sessionToken", "callbackUrl", "csrfToken"] as const) {
      assert.equal(c[k]!.options.secure, true);
      assert.equal(c[k]!.options.path, "/");
      assert.equal(c[k]!.options.httpOnly, true);
    }
  });
});

describe("GV-6 addresses", () => {
  test("machines use INSTANCE_URL, falling back to NEXTAUTH_URL, then the request origin", () => {
    const both = { NEXTAUTH_URL: "https://dashboard.funnelliner.com", INSTANCE_URL: "https://dashboard.funnelliner.com/_c/giftvaly/" };
    assert.equal(instanceUrl("", both), "https://dashboard.funnelliner.com/_c/giftvaly");
    assert.equal(
      steadfastCallbackUrl("", both),
      "https://dashboard.funnelliner.com/_c/giftvaly/api/webhooks/steadfast"
    );
    assert.equal(instanceUrl("", { NEXTAUTH_URL: "http://localhost:3000/" }), "http://localhost:3000");
    assert.equal(instanceUrl("http://localhost:3000", {}), "http://localhost:3000");
  });
  test("the Steadfast callback URL is built only through steadfastCallbackUrl()", () => {
    const sources = walk("app").concat(walk("lib"), walk("components"));
    const builders = sources.filter((f) => f.text.includes("/api/webhooks/steadfast`"));
    assert.deepEqual(builders.map((f) => f.rel), ["lib/platform/addresses.ts"]);
    for (const rel of ["app/(dashboard)/courier/page.tsx", "app/api/couriers/steadfast/settings/route.ts"]) {
      const text = readFileSync(path.join(ROOT, rel), "utf8");
      assert.match(text, /steadfastCallbackUrl\(/, rel);
      // Code, not comments, must not build it from the people's address.
      assert.doesNotMatch(text.replace(/^\s*\/\/.*$/gm, ""), /NEXTAUTH_URL/, rel);
    }
  });
  test("no hardcoded funnelliner host in app code (CLAUDE.md rule 9)", () => {
    const hits = walk("app").concat(walk("lib"), walk("components"))
      .filter((f) => /https?:\/\/[a-z.-]*funnelliner\.com/.test(f.text.replace(/^\s*(\/\/|\*).*$/gm, "")));
    assert.deepEqual(hits.map((f) => f.rel), []);
  });
});

describe("CLAUDE.md rule 7 — no page or route starts with /go/ or /_c/", () => {
  test("app/ has no first URL segment named go or _c (route groups ignored)", () => {
    const offenders: string[] = [];
    const visit = (dir: string) => {
      for (const name of readdirSync(path.join(ROOT, dir))) {
        const rel = `${dir}/${name}`;
        if (!statSync(path.join(ROOT, rel)).isDirectory()) continue;
        if (/^\(.*\)$/.test(name)) visit(rel); // (dashboard) adds no URL segment
        else if (name === "go" || name === "_c" || name === "%5Fc") offenders.push(rel);
      }
    };
    visit("app");
    assert.deepEqual(offenders, []);
  });
});

function walk(dir: string, out: { rel: string; text: string }[] = []) {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push({ rel, text: readFileSync(path.join(ROOT, rel), "utf8") });
  }
  return out;
}
