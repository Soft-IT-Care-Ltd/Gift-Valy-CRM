// FUNNEL_LINER.md GV-7…GV-9 — the billing lock (lib/platform/lock.ts +
// gate.ts, enforced by proxy.ts), the Billing page's estimate and words, and
// the reminder's Dhaka-day math. No database.
// Run: npm run test:platform
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { BILLING_LOCK_OPEN, LOCK_CODE, LOCK_MESSAGE_BN, lockVerdict } from "../lib/platform/lock";
import { billingLockGate } from "../lib/platform/gate";
import {
  billingReminder,
  billingStatus,
  dhakaDaysLeft,
  estimateBill,
} from "../lib/platform/billing-display";
import { ACTIVE_STATE, type PlatformState, type PlatformStateName } from "../lib/platform/state-shape";
import { validSnapshot } from "./fixtures/platform";

const ROOT = path.resolve(__dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Every address the app answers: pages, API routes, metadata files, public/ files. */
function everyAddress(): { path: string; kind: "page" | "api" | "file" }[] {
  const app = path.join(ROOT, "app");
  const out: { path: string; kind: "page" | "api" | "file" }[] = [];
  for (const file of walk(app)) {
    const rel = path.relative(app, file).split(path.sep);
    const name = rel.pop()!;
    const segs = rel
      .filter((s) => !(s.startsWith("(") && s.endsWith(")")))
      .map((s) => s.replace(/^\[\.\.\.(.+)\]$/, "$1-a/$1-b").replace(/^\[(.+)\]$/, "sample-$1"));
    const url = "/" + segs.join("/");
    if (name === "page.tsx") out.push({ path: url, kind: "page" });
    else if (name === "route.ts") out.push({ path: url, kind: "api" });
    else if (name === "manifest.ts") out.push({ path: "/manifest.webmanifest", kind: "file" });
    else if (name === "favicon.ico") out.push({ path: "/favicon.ico", kind: "file" });
  }
  for (const file of walk(path.join(ROOT, "public"))) {
    out.push({ path: "/" + path.relative(path.join(ROOT, "public"), file).split(path.sep).join("/"), kind: "file" });
  }
  return out;
}

const state = (s: PlatformStateName, extra: Partial<PlatformState> = {}): PlatformState => ({
  ...ACTIVE_STATE,
  state: s,
  ...extra,
});

describe("GV-7 closed by default", () => {
  // Opening anything new means adding it to lib/platform/lock.ts WITH a
  // reason, and here. Everything else the app has is locked.
  const EXPECTED_OPEN = [
    "/api/account/change-password",
    "/api/auth/nextauth-a/nextauth-b",
    "/api/cron/steadfast-sync",
    "/api/platform/billing",
    "/api/platform/has-user",
    "/api/platform/state",
    "/api/platform/usage",
    "/api/webhooks/steadfast",
    "/billing",
    "/billing/invoices/sample-number",
    "/change-password",
    "/favicon.ico",
    "/fonts/NotoSansBengali-Bold.ttf",
    "/fonts/NotoSansBengali-Regular.ttf",
    "/gift-valy-logo.png",
    "/icons/apple-touch-icon.png",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
    "/login",
    "/manifest.webmanifest",
    "/offline.html",
    "/sw.js",
  ];

  test("exactly the documented pages, routes and files stay open", () => {
    const all = everyAddress();
    assert.ok(all.length > 100, "the walk found the app");
    const open = all.filter((a) => lockVerdict("GET", a.path) === "open").map((a) => a.path).sort();
    assert.deepEqual([...new Set(open)], EXPECTED_OPEN);
  });

  test("every other page redirects and every other API route refuses", () => {
    for (const a of everyAddress()) {
      if (EXPECTED_OPEN.includes(a.path)) continue;
      const v = lockVerdict("GET", a.path);
      if (a.kind === "api") assert.equal(v, "refuse", a.path);
      else assert.equal(v, "redirect", a.path);
    }
  });

  test("a page or route added tomorrow is locked", () => {
    assert.equal(lockVerdict("GET", "/brand-new-page"), "redirect");
    assert.equal(lockVerdict("GET", "/api/brand-new/export"), "refuse");
    assert.equal(lockVerdict("POST", "/api/brand-new"), "refuse");
    assert.equal(lockVerdict("GET", "/uploads/photo.jpg"), "redirect");
    assert.equal(lockVerdict("GET", "/api/cron/trash-cleanup"), "refuse");
  });

  test("look-alikes and writes to pages don't slip through", () => {
    assert.equal(lockVerdict("GET", "/billingx"), "redirect");
    assert.equal(lockVerdict("GET", "/login/other"), "redirect");
    assert.equal(lockVerdict("GET", "/api/platformx"), "refuse");
    assert.equal(lockVerdict("GET", "/api/cron/steadfast-sync-all"), "refuse");
    assert.equal(lockVerdict("POST", "/orders"), "refuse");
    assert.equal(lockVerdict("GET", "/billing/"), "open");
    assert.equal(lockVerdict("POST", "/api/auth/signout"), "open");
  });

  test("every open rule has a reason", () => {
    for (const rule of Object.values(BILLING_LOCK_OPEN).flat()) assert.ok(rule.why.length > 5, String(rule.path));
  });

  test("proxy.ts calls the gate for everything but _next/static and _next/image", () => {
    const src = readFileSync(path.join(ROOT, "proxy.ts"), "utf8");
    assert.match(src, /billingLockGate\(req\.method, req\.nextUrl\)/);
    assert.match(src, /matcher: \["\/\(\(\?!_next\/static\|_next\/image\)\.\*\)"\]/);
  });
});

describe("GV-7 gate", () => {
  const url = (p: string) => new URL(p, "http://localhost:3000");
  const reads = (s: PlatformStateName) => {
    let calls = 0;
    const read = async () => {
      calls++;
      return state(s);
    };
    return { read, calls: () => calls };
  };

  test("suspended: a page goes to /billing, an API route gets 423 in English and Bangla", async () => {
    const page = await billingLockGate("GET", url("/orders?tab=all"), reads("suspended").read);
    assert.equal(page?.status, 307);
    assert.equal(page?.headers.get("location"), "http://localhost:3000/billing");

    const api = await billingLockGate("GET", url("/api/reports/sales/export"), reads("suspended").read);
    assert.equal(api?.status, 423);
    const body = await api!.json();
    assert.equal(body.code, LOCK_CODE);
    assert.ok(body.error.includes("Funnel Liner bill is unpaid"));
    assert.ok(body.error.includes(LOCK_MESSAGE_BN));
  });

  test("past_due and active lock nothing", async () => {
    for (const s of ["active", "past_due"] as const) {
      assert.equal(await billingLockGate("GET", url("/orders"), reads(s).read), null);
      assert.equal(await billingLockGate("POST", url("/api/orders"), reads(s).read), null);
      assert.equal(await billingLockGate("GET", url("/api/cron/trash-cleanup"), reads(s).read), null);
    }
  });

  test("open paths never read the state (no query for them)", async () => {
    const r = reads("suspended");
    for (const p of ["/_next/static/chunks/a.js", "/sw.js", "/login", "/api/auth/session", "/api/platform/state"]) {
      assert.equal(await billingLockGate("GET", url(p), r.read), null, p);
    }
    assert.equal(r.calls(), 0);
  });
});

describe("GV-8 estimate", () => {
  const plan = validSnapshot().plan;

  test("up to freeUpTo: fixed fee only", () => {
    const e = estimateBill(plan, 20);
    assert.equal(e.totalPaisa, plan.fixedFeePaisa);
    assert.equal(e.lines.length, 1);
  });

  test("347 orders → 21–500 band, ৳3,800 like the spec's invoice", () => {
    const e = estimateBill(plan, 347);
    assert.equal(e.bandLabel, "21–500 orders");
    assert.equal(e.totalPaisa, 380000);
  });

  test("band edges", () => {
    assert.equal(estimateBill(plan, 21).bandLabel, "21–500 orders");
    assert.equal(estimateBill(plan, 500).bandLabel, "21–500 orders");
    assert.equal(estimateBill(plan, 501).bandLabel, "501–1000 orders");
    assert.equal(estimateBill(plan, 2000).totalPaisa, plan.fixedFeePaisa + 400000);
  });

  test("past the last band each 500 (or part) adds the step fee", () => {
    assert.equal(estimateBill(plan, 2001).totalPaisa, plan.fixedFeePaisa + 500000);
    assert.equal(estimateBill(plan, 2001).bandLabel, "2001–2500 orders");
    assert.equal(estimateBill(plan, 2501).totalPaisa, plan.fixedFeePaisa + 600000);
  });
});

describe("GV-8 / GV-9 words and Dhaka days", () => {
  // 03:00 Dhaka on 4 Nov 2026 is still 3 Nov in UTC — counted in Dhaka days.
  const now = new Date("2026-11-03T21:00:00Z");

  test("days left are Dhaka days", () => {
    assert.equal(dhakaDaysLeft("2026-11-07", now), 3);
    assert.equal(dhakaDaysLeft("2026-11-04", now), 0);
    assert.equal(dhakaDaysLeft("2026-11-03", now), -1);
  });

  test("status line", () => {
    assert.equal(billingStatus(state("active"), null, now).en, "All paid");
    const due = billingStatus(state("past_due", { dueOn: "2026-11-07" }), null, now);
    assert.equal(due.en, "Bill due by Sat 7 Nov — 3 days left");
    assert.equal(due.tone, "due");
    const sus = billingStatus(state("suspended", { changedAt: "2026-11-08T02:00:00Z" }), null, now);
    assert.equal(sus.en, "Suspended since Sun 8 Nov — pay to open the dashboard");
    assert.ok(sus.bn.length > 0);
  });

  test("reminder: amber before, red on the due date, nothing unless past_due", () => {
    const r = billingReminder(state("past_due", { dueOn: "2026-11-07", amountDue: "৳3,800" }), now)!;
    assert.equal(r.en, "Your Funnel Liner bill of ৳3,800 is due by Sat 7 Nov — 3 days left.");
    assert.equal(r.tone, "due");
    const last = billingReminder(state("past_due", { dueOn: "2026-11-04", amountDue: "৳3,800" }), now)!;
    assert.equal(last.tone, "last-day");
    assert.match(last.en, /today is the last day/);
    assert.equal(billingReminder(state("active", { dueOn: "2026-11-07" }), now), null);
    assert.equal(billingReminder(state("suspended", { dueOn: "2026-11-07" }), now), null);
  });
});
