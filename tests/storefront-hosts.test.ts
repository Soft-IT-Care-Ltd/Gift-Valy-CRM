// ROUND3 W-1 — two front doors (lib/storefront/hosts.ts + front-door.ts,
// called by proxy.ts). No database: the platform state is stubbed.
// Run: npm run test:storefront
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { frontDoor, type ReadState } from "../lib/storefront/front-door";
import {
  isStorefrontHost,
  storefrontHosts,
  storefrontRoute,
  STOREFRONT_PREFIX,
} from "../lib/storefront/hosts";
import type { PlatformStateName } from "../lib/platform/state-shape";

const ROOT = path.resolve(__dirname, "..");
// The env value is passed in, never read from the machine (rule 9: the hosts
// come from STOREFRONT_HOSTS; these are the test's own).
const HOSTS = "giftvaly.test, www.giftvaly.test,shop-staging.giftvaly.test";
const WEBSITE = "giftvaly.test";
const ERP = "erp.example.test";

function reader(s: PlatformStateName) {
  let calls = 0;
  const read: ReadState = async () => {
    calls++;
    return { state: s };
  };
  return { read, calls: () => calls };
}

const request = (host: string | null, p: string, method = "GET") => {
  const headers = new Headers();
  if (host) headers.set("host", host);
  return { method, nextUrl: new URL(p, `https://${host ?? "localhost"}`), headers };
};

const rewriteOf = (res: Response) => {
  const to = res.headers.get("x-middleware-rewrite");
  return to ? new URL(to).pathname : null;
};
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

// ---------- the app's own route table ----------

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Every storefront page/route as a matcher over the INTERNAL path. */
function storefrontRoutes(): RegExp[] {
  const base = path.join(ROOT, "app", "(store)", "storefront");
  return walk(base)
    .filter((f) => /[/\\](page\.tsx|route\.ts)$/.test(f))
    .map((f) => {
      const segs = path
        .relative(base, path.dirname(f))
        .split(path.sep)
        .filter((s) => s && !/^\(.*\)$/.test(s))
        .map((s) =>
          /^\[\[?\.\.\./.test(s) ? ".+" : /^\[.+\]$/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        );
      return new RegExp(`^${STOREFRONT_PREFIX}${segs.length ? "/" + segs.join("/") : ""}$`);
    });
}

const ERP_PATHS = [
  "/login",
  "/change-password",
  "/billing",
  "/billing/invoices/GV-1",
  "/orders",
  "/catalog/products",
  "/settings",
  "/packing",
  "/design-system",
  "/api/orders",
  "/api/auth/session",
  "/api/auth/signin",
  "/api/cron/steadfast-sync",
  "/api/webhooks/steadfast",
  "/api/platform/state",
  "/api/uploads",
  "/uploads/abc.jpg",
  "/uploads/print/x.jpg",
  "/manifest.webmanifest",
  "/sw.js",
  "/favicon.ico",
  "/gift-valy-logo.png",
];

describe("W-1 host matching (STOREFRONT_HOSTS)", () => {
  test("names from the env, port, case and trailing dot ignored", () => {
    assert.deepEqual(storefrontHosts(HOSTS), ["giftvaly.test", "www.giftvaly.test", "shop-staging.giftvaly.test"]);
    for (const h of ["giftvaly.test", "GiftValy.Test", "giftvaly.test:443", "www.giftvaly.test", "shop-staging.giftvaly.test:3210", "giftvaly.test."])
      assert.equal(isStorefrontHost(h, HOSTS), true, h);
    for (const h of [ERP, "evil-giftvaly.test", "giftvaly.test.evil.test", "localhost:3000", "", null, undefined])
      assert.equal(isStorefrontHost(h, HOSTS), false, String(h));
  });

  test("unset or empty env = no website host (the app is the ERP only)", () => {
    assert.deepEqual(storefrontHosts(undefined), []);
    assert.deepEqual(storefrontHosts(" , "), []);
    assert.equal(isStorefrontHost(WEBSITE, undefined), false);
    assert.equal(isStorefrontHost(WEBSITE, ""), false);
  });

  test("no host name is hardcoded in the front door (rule 9)", () => {
    for (const rel of ["lib/storefront/hosts.ts", "lib/storefront/front-door.ts", "proxy.ts"]) {
      const code = readFileSync(path.join(ROOT, rel), "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
      assert.doesNotMatch(code, /giftvaly\.com|funnelliner\.com/, rel);
    }
  });
});

describe("W-1 website host", () => {
  const routes = storefrontRoutes();
  const served = (internal: string) => routes.some((r) => r.test(internal));

  test("the walk found the storefront section", () => {
    assert.ok(routes.some((r) => r.test(STOREFRONT_PREFIX)), "home page");
  });

  test("public paths are rewritten into the storefront section", async () => {
    const { read } = reader("active");
    const cases: [string, string][] = [
      ["/", "/storefront"],
      ["/p/eid-hamper", "/storefront/p/eid-hamper"],
      ["/c/chocolates", "/storefront/c/chocolates"],
      ["/api/shop/order", "/storefront/api/shop/order"],
      ["/img/abc-720.webp", "/storefront/img/abc-720.webp"],
    ];
    for (const [from, to] of cases) {
      const res = await frontDoor(request(WEBSITE, from), read, HOSTS);
      assert.equal(rewriteOf(res), to, from);
      assert.equal(res.headers.get("x-frame-options"), "DENY");
    }
  });

  test("every ERP path is a plain 404 — never a redirect, never an ERP page", async () => {
    const { read } = reader("active");
    for (const p of [...ERP_PATHS, "/storefront", "/storefront/p/x"]) {
      for (const method of ["GET", "POST"]) {
        const res = await frontDoor(request(WEBSITE, p, method), read, HOSTS);
        assert.ok(res.status < 300 || res.status === 404, `${p} → ${res.status}`);
        assert.equal(res.headers.get("location"), null, p);
        const to = rewriteOf(res);
        if (to === null) {
          assert.equal(res.status, 404, `${p} must be a 404`);
          continue;
        }
        // Rewritten into the storefront, where no such page exists → Next's 404.
        assert.ok(to.startsWith(`${STOREFRONT_PREFIX}/`), `${p} → ${to}`);
        assert.equal(served(to), false, `${p} would be answered by the storefront at ${to}`);
      }
    }
  });

  test("the internal prefix is never reachable by name", async () => {
    const { read } = reader("active");
    for (const p of ["/storefront", "/storefront/", "/storefront/p/x", "/storefront/api/shop/order"]) {
      const res = await frontDoor(request(WEBSITE, p), read, HOSTS);
      assert.equal(res.status, 404, p);
      assert.equal(rewriteOf(res), null, p);
    }
  });

  test("the billing lock is never consulted — open while suspended, POST /api/shop/* included", async () => {
    const r = reader("suspended");
    for (const [p, method] of [["/", "GET"], ["/p/x", "GET"], ["/api/shop/order", "POST"]] as const) {
      const res = await frontDoor(request(WEBSITE, p, method), r.read, HOSTS);
      assert.ok(rewriteOf(res), p);
      assert.notEqual(res.status, 423);
    }
    assert.equal(r.calls(), 0, "state never read on the website host");
  });

  test("/go/ and /_c/ are Funnel Liner's: a plain 404, never rewritten", async () => {
    const { read } = reader("active");
    for (const p of ["/go/x", "/go", "/_c/giftvaly/api/webhooks/steadfast", "/_c", "/%5Fc/x"]) {
      const res = await frontDoor(request(WEBSITE, p), read, HOSTS);
      assert.equal(res.status, 404, p);
      assert.equal(rewriteOf(res), null, p);
    }
  });

  test("the build's files and public/shop/ pass unchanged", async () => {
    const { read } = reader("active");
    for (const p of ["/shop/logo.png", "/_next/static/chunks/a.js", "/_next/webpack-hmr"]) {
      const res = await frontDoor(request(WEBSITE, p), read, HOSTS);
      assert.ok(passes(res), p);
      assert.equal(rewriteOf(res), null, p);
    }
  });

  test("STOREFRONT_NOINDEX marks the copy noindex (staging)", async () => {
    const { read } = reader("active");
    const before = process.env.STOREFRONT_NOINDEX;
    try {
      process.env.STOREFRONT_NOINDEX = "1";
      const res = await frontDoor(request(WEBSITE, "/"), read, HOSTS);
      assert.match(res.headers.get("x-robots-tag") ?? "", /noindex/);
      delete process.env.STOREFRONT_NOINDEX;
      const prod = await frontDoor(request(WEBSITE, "/"), read, HOSTS);
      assert.equal(prod.headers.get("x-robots-tag"), null);
    } finally {
      if (before === undefined) delete process.env.STOREFRONT_NOINDEX;
      else process.env.STOREFRONT_NOINDEX = before;
    }
  });

  test("storefrontRoute is total: everything is pass, rewrite or 404", () => {
    assert.deepEqual(storefrontRoute("/"), { rewrite: "/storefront" });
    assert.deepEqual(storefrontRoute("/storefrontx"), { rewrite: "/storefront/storefrontx" });
  });
});

describe("W-1 ERP host", () => {
  test("the storefront section doesn't exist there", async () => {
    const { read } = reader("active");
    for (const p of ["/storefront", "/storefront/", "/storefront/p/x", "/storefront/api/shop/order", "/storefront/img/a-360.webp"]) {
      const res = await frontDoor(request(ERP, p), read, HOSTS);
      assert.equal(res.status, 404, p);
    }
  });

  test("ERP paths are untouched (no rewrite) and still locked while suspended", async () => {
    const active = reader("active");
    for (const p of ["/login", "/orders", "/api/orders", "/p/x", "/"]) {
      const res = await frontDoor(request(ERP, p), active.read, HOSTS);
      assert.ok(passes(res), p);
      assert.equal(rewriteOf(res), null, p);
    }
    const suspended = reader("suspended");
    const page = await frontDoor(request(ERP, "/orders"), suspended.read, HOSTS);
    assert.equal(page.status, 307);
    assert.equal(new URL(page.headers.get("location")!).pathname, "/billing");
    const api = await frontDoor(request(ERP, "/api/orders"), suspended.read, HOSTS);
    assert.equal(api.status, 423);
    const login = await frontDoor(request(ERP, "/login"), suspended.read, HOSTS);
    assert.ok(passes(login));
  });

  test("/go/ and /_c/ pass through untouched (Nginx gives them to Funnel Liner)", async () => {
    const { read } = reader("active");
    for (const p of ["/go/x", "/_c/giftvaly/x"]) {
      const res = await frontDoor(request(ERP, p), read, HOSTS);
      assert.equal(rewriteOf(res), null, p);
      assert.equal(res.headers.get("location"), null, p);
    }
  });

  test("a request with no Host header is the ERP", async () => {
    const { read } = reader("active");
    const res = await frontDoor(request(null, "/storefront"), read, HOSTS);
    assert.equal(res.status, 404);
  });
});

describe("W-1 separation in the code", () => {
  const files = (dir: string) =>
    (existsSync(path.join(ROOT, dir)) ? walk(path.join(ROOT, dir)) : [])
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => ({ rel: path.relative(ROOT, f), text: readFileSync(f, "utf8") }));

  test("nothing on the website reads the staff session", () => {
    const offenders = [...files("app/(store)"), ...files("lib/storefront"), ...files("components/storefront")]
      .filter((f) => /from\s+["'](next-auth[^"']*|@\/lib\/auth|@\/lib\/authz|@\/lib\/page-auth|@\/lib\/rbac)["']|getServerSession|\bcookies\(\)/.test(f.text))
      .map((f) => f.rel);
    assert.deepEqual(offenders, []);
  });

  test("the website's root layout loads none of the ERP's providers, theme, PWA or service worker", () => {
    const layout = readFileSync(path.join(ROOT, "app/(store)/layout.tsx"), "utf8");
    assert.doesNotMatch(layout, /ThemeProvider|PwaRegister|Toaster|globals\.css|sw\.js|manifest/);
    assert.equal(statSync(path.join(ROOT, "app/(erp)/layout.tsx")).isFile(), true);
    assert.throws(() => statSync(path.join(ROOT, "app/layout.tsx")), "no shared root layout");
  });

  test("no storefront page starts with /go/ or /_c/ on the website host (rule 7)", () => {
    const offenders = readdirSync(path.join(ROOT, "app/(store)/storefront")).filter((n) => /^(go|_c|%5Fc)$/i.test(n));
    assert.deepEqual(offenders, []);
  });
});
