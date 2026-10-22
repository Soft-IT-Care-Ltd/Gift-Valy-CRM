// FUNNEL_LINER.md GV-11…GV-14 — pins the server files (DEPLOYMENT.md), so a
// later edit can't quietly point Gift Valy at another shop's port or host,
// open /go/ or /_c/, let Nginx serve the upload or invoice folders, put a
// secret in the cron file, or let deploy.sh touch the database with anything
// but `prisma migrate deploy`.
// Run: npm run test:deploy
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { assertPrivateDir, invoicePdfPath, invoiceRoot, uploadPath, uploadRoot, uploadUrlPath } from "../lib/file-storage";
import { databaseName, demoSeedRefusal } from "../lib/seed-guard";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
/** The file without its comment lines (# for shell and Nginx, // for JS). */
const code = (text: string) => text.split("\n").filter((l) => !/^\s*(#|\/\/)/.test(l)).join("\n");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const requireCjs = createRequire(__filename);

type PmApp = { name: string; cwd: string; args: string; exec_mode: string; instances: number; env: Record<string, string>; out_file: string; error_file: string };
const pm2 = (file: string): PmApp => {
  const apps = requireCjs(path.join(ROOT, file)).apps as PmApp[];
  assert.equal(apps.length, 1, `${file}: one app`);
  return apps[0];
};

describe("PM2", () => {
  test("production: giftvaly on localhost:3200, staging: giftvaly-staging on localhost:3210", () => {
    for (const [file, name, base, port, log] of [
      ["deploy/ecosystem.config.cjs", "giftvaly", "/srv/giftvaly", 3200, "app"],
      ["deploy/ecosystem.staging.config.cjs", "giftvaly-staging", "/srv/giftvaly-staging", 3210, "staging"],
    ] as const) {
      const app = pm2(file);
      assert.equal(app.name, name);
      assert.equal(app.cwd, `${base}/app`);
      // "localhost", never 127.0.0.1 (Antu's CLAUDE.md "Stack gotchas").
      assert.equal(app.args, `start --hostname localhost --port ${port}`);
      assert.equal(app.exec_mode, "fork");
      assert.equal(app.instances, 1);
      assert.equal(app.env.TZ, "Asia/Dhaka");
      assert.equal(app.env.NODE_ENV, "production");
      assert.equal(app.out_file, `/var/log/giftvaly/${log}.log`);
      assert.equal(app.error_file, `/var/log/giftvaly/${log}-error.log`);
    }
  });

  test("never another app's port (Antu 3000/3100, admin panel 3300/3310)", () => {
    for (const file of walk(path.join(ROOT, "deploy")).concat(["scripts/deploy.sh", "scripts/run-job.sh", "scripts/backup.sh"].map((f) => path.join(ROOT, f)))) {
      assert.doesNotMatch(code(readFileSync(file, "utf8")), /\b(3000|3100|3300|3310)\b/, path.relative(ROOT, file));
    }
  });
});

describe("Nginx", () => {
  const staging = code(read("deploy/nginx/giftvaly-staging.conf"));
  const guard = code(read("deploy/nginx/snippets/giftvaly-staging-guard.conf"));
  const legacy = code(read("deploy/nginx/giftvaly-legacy-redirect.conf"));
  const blocks = (site: string) => site.split(/^server \{/m).slice(1);

  test("staging: only gv-staging.funnelliner.com, only to the staging app on :3210", () => {
    assert.deepEqual([...staging.matchAll(/server_name ([^;]+);/g)].map((m) => m[1]), ["gv-staging.funnelliner.com", "gv-staging.funnelliner.com"]);
    const upstreams = [...(staging + guard).matchAll(/proxy_pass (\S+);/g)].map((m) => m[1]);
    assert.ok(upstreams.length >= 3);
    for (const u of upstreams) assert.match(u, /^http:\/\/127\.0\.0\.1:3210\/?$/);
  });

  test("machines use /_c/giftvaly/ with the prefix stripped; any other /_c/ and /go/ → 404", () => {
    assert.match(staging, /location \/_c\/giftvaly\/ \{\s*proxy_pass http:\/\/127\.0\.0\.1:3210\/;/);
    assert.match(staging, /location \/_c\/ \{ return 404; \}/);
    assert.match(staging, /location \/go\/ \{ return 404; \}/);
  });

  test("every server block takes the real IP from Cloudflare and answers certificate checks", () => {
    for (const site of [staging, legacy]) {
      assert.equal(blocks(site).length, 2);
      for (const b of blocks(site)) {
        assert.match(b, /include snippets\/cloudflare-real-ip\.conf;/);
        assert.match(b, /include snippets\/acme-challenge\.conf;/);
      }
    }
  });

  test("staging asks for a password and says noindex, in its HTTPS block", () => {
    assert.match(blocks(staging)[1], /include snippets\/giftvaly-staging-guard\.conf;/);
    assert.match(guard, /auth_basic_user_file \/etc\/nginx\/giftvaly-staging\.htpasswd;/);
    assert.match(guard, /add_header X-Robots-Tag "noindex/);
    assert.match(blocks(staging)[0], /return 301 https:\/\/\$host\$request_uri;/);
  });

  test("Nginx never serves a folder: no root or alias anywhere (GV-11)", () => {
    for (const file of walk(path.join(ROOT, "deploy/nginx"))) {
      assert.doesNotMatch(code(readFileSync(file, "utf8")), /^\s*(root|alias)\s/m, path.relative(ROOT, file));
    }
  });

  test("app.giftvaly.com only redirects (301) to https://dashboard.funnelliner.com", () => {
    assert.deepEqual([...legacy.matchAll(/server_name ([^;]+);/g)].map((m) => m[1]), ["app.giftvaly.com", "app.giftvaly.com"]);
    assert.doesNotMatch(legacy, /proxy_pass/);
    const returns = [...legacy.matchAll(/return (\d+) (\S+);/g)].map((m) => `${m[1]} ${m[2]}`);
    assert.deepEqual(returns, ["301 https://dashboard.funnelliner.com/", "301 https://dashboard.funnelliner.com/"]);
  });

  test("production has no site file of its own — it is reached through dashboard.funnelliner.com (GV-16)", () => {
    assert.deepEqual(
      readdirSync(path.join(ROOT, "deploy/nginx")).filter((n) => n.endsWith(".conf")).sort(),
      ["giftvaly-legacy-redirect.conf", "giftvaly-staging.conf"]
    );
  });
});

describe("no page or route starts with /go/ or /_c/ (CLAUDE.md rule 7)", () => {
  test("first URL segment of everything under app/", () => {
    // Route groups "(x)" add no segment; look through them.
    const firstSegments = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        if (!statSync(p).isDirectory()) return [];
        return /^\(.+\)$/.test(n) ? firstSegments(p) : [n];
      });
    const segments = firstSegments(path.join(ROOT, "app"));
    assert.ok(segments.includes("uploads") && segments.includes("api"));
    for (const s of segments) assert.ok(!["go", "_c"].includes(s.toLowerCase()), `app/${s}`);
    for (const f of walk(path.join(ROOT, "public"))) {
      const first = path.relative(path.join(ROOT, "public"), f).split(path.sep)[0];
      assert.ok(!["go", "_c"].includes(first.toLowerCase()), `public/${first}`);
    }
  });
});

describe("cron (GV-13)", () => {
  const cron = code(read("deploy/cron/giftvaly"));
  const line = (what: string) => cron.split("\n").find((l) => l.includes(what)) ?? "";

  test("each job at its Dhaka time (the server is UTC), as the deploy user", () => {
    assert.match(line("run-job.sh steadfast-sync"), /^\*\/15 \* \* \* \* +deploy +\$APP\/scripts\/run-job\.sh steadfast-sync /);
    assert.match(line("run-job.sh trash-cleanup"), /^30 21 \* \* \* +deploy +\$APP\/scripts\/run-job\.sh trash-cleanup /);
    assert.match(line("backup.sh  "), /^0 21 \* \* \* +deploy +\$APP\/scripts\/backup\.sh  /);
    assert.match(line("backup.sh --hourly"), /^0 4-16 \* \* \* +deploy +\$APP\/scripts\/backup\.sh --hourly /);
    assert.match(cron, /^APP=\/srv\/giftvaly\/app$/m);
    const jobs = cron.split("\n").filter((l) => /^[\d*]/.test(l));
    assert.equal(jobs.length, 4);
    for (const j of jobs) assert.match(j, />> \/var\/log\/giftvaly\/(cron|backup)\.log 2>&1$/);
  });

  test("calls the app on localhost only, holds no secret, and every job is a real route", () => {
    assert.doesNotMatch(cron, /SECRET|https?:\/\/|curl/);
    const runner = read("scripts/run-job.sh");
    assert.match(runner, /URL="\$\{GIFTVALY_URL:-http:\/\/127\.0\.0\.1:3200\}"/);
    assert.match(runner, /ENV_FILE="\$\{GIFTVALY_ENV:-\/srv\/giftvaly\/shared\/\.env\}"/);
    assert.match(runner, /curl -fsS -m \d+ -K - "\$URL\/api\/cron\/\$JOB"/);
    assert.doesNotMatch(code(runner), /-H "Authorization/);
    assert.doesNotMatch(code(runner), /funnelliner|https:\/\//);
    for (const job of /\^\(([^)]+)\)\$/.exec(runner)![1].split("|")) {
      assert.ok(existsSync(path.join(ROOT, "app/api/cron", job, "route.ts")), job);
    }
  });

  test("vercel.json is gone — the server's cron file is the only scheduler", () => {
    assert.ok(!existsSync(path.join(ROOT, "vercel.json")));
  });

  test("logrotate covers every log the app, cron and backups write", () => {
    assert.match(code(read("deploy/logrotate/giftvaly")), /^\/var\/log\/giftvaly\/\*\.log \{/m);
  });
});

describe("scripts/backup.sh (GV-13)", () => {
  const backup = code(read("scripts/backup.sh"));
  test("everything off the server is under a giftvaly- prefix", () => {
    assert.match(backup, /DUMP_FILE="giftvaly-db-\$STAMP\.dump"/);
    assert.match(backup, /remote_path giftvaly-hourly/);
    assert.match(backup, /rclone sync "\$dir" "\$\(remote_path "giftvaly-\$name"\)" --backup-dir "\$\(remote_path "giftvaly-files-old\/\$STAMP\/\$name"\)"/);
    assert.match(backup, /"uploads:\$UPLOADS" "invoices:\$INVOICES"/);
  });
  test("only reads the database and never deletes off the server", () => {
    assert.match(backup, /"\$PG_RESTORE" --list /);
    assert.doesNotMatch(backup, /pg_restore[^\n]*--dbname|DROP |rclone (delete|purge|deletefile)/);
  });
});

describe("scripts/deploy.sh (GV-14)", () => {
  const deploy = read("scripts/deploy.sh");
  test("each copy: its own folder, database, roles, address and port", () => {
    assert.match(deploy, /BASE="\$\{GIFTVALY_BASE:-\/srv\/giftvaly-staging\}"\n\s+DB_NAME=giftvaly_staging; OWNER_ROLE=giftvaly_staging_owner; APP_ROLE=giftvaly_staging_app\n\s+PUBLIC_URL="https:\/\/gv-staging\.funnelliner\.com"\n\s+ECOSYSTEM=deploy\/ecosystem\.staging\.config\.cjs; PORT=3210;/);
    assert.match(deploy, /BASE="\$\{GIFTVALY_BASE:-\/srv\/giftvaly\}"\n\s+DB_NAME=giftvaly; OWNER_ROLE=giftvaly_owner; APP_ROLE=giftvaly_app\n\s+PUBLIC_URL="https:\/\/dashboard\.funnelliner\.com"\n\s+ECOSYSTEM=deploy\/ecosystem\.config\.cjs; PORT=3200;/);
    assert.match(deploy, /REPO_URL="\$\{GIFTVALY_REPO:-git@github-giftvaly:Soft-IT-Care-Ltd\/Gift-Valy-CRM\.git\}"/);
    assert.match(deploy, /curl -fsS -o \/dev\/null -m 5 "http:\/\/127\.0\.0\.1:\$PORT\/login"/);
    assert.match(deploy, /^KEEP=5$/m);
  });
  test("refuses an .env that could reach the wrong database, keep files in a release, or hold dev-only settings", () => {
    assert.match(deploy, /\[\[ "\$\(env_value INSTANCE_URL\)" == "\$PUBLIC_URL\/_c\/giftvaly" \]\]/);
    assert.match(deploy, /"UPLOAD_DIR:\$BASE\/uploads" "INVOICE_DIR:\$BASE\/invoices"/);
    for (const v of ["SHADOW_DATABASE_URL", "BOOTSTRAP_ADMIN_PASSWORD", "COURIER_ENCRYPTION_KEY must differ from NEXTAUTH_SECRET", "PLATFORM_SECRET must differ from CRON_SECRET"]) {
      assert.ok(deploy.includes(v), v);
    }
  });
  test("only ever runs `prisma migrate deploy` against the database", () => {
    assert.match(code(deploy), /npx prisma migrate deploy/);
    assert.doesNotMatch(code(deploy), /migrate (dev|reset)|db push|db seed|DROP |TRUNCATE/);
  });
});

describe("PostgreSQL access", () => {
  test("Gift Valy's roles reach only Gift Valy's databases", () => {
    const rows = code(read("deploy/postgresql/pg_hba-giftvaly.conf")).split("\n").filter((l) => l.trim()).map((l) => l.trim().split(/\s+/));
    assert.equal(rows.length, 6);
    for (const [, db, users] of rows) {
      assert.match(db, /^giftvaly(_staging)?$/);
      assert.deepEqual(users.split(","), [`${db}_owner`, `${db}_app`]);
    }
  });
});

describe("uploads and invoices outside the release (GV-11)", () => {
  test("development defaults stay in the gitignored storage/ folder", () => {
    const before = { u: process.env.UPLOAD_DIR, i: process.env.INVOICE_DIR };
    delete process.env.UPLOAD_DIR;
    delete process.env.INVOICE_DIR;
    try {
      assert.equal(uploadRoot(), path.resolve(process.cwd(), "storage/uploads"));
      assert.equal(invoiceRoot(), path.resolve(process.cwd(), "storage/invoices"));
      process.env.UPLOAD_DIR = "/srv/giftvaly/uploads";
      process.env.INVOICE_DIR = "/srv/giftvaly/invoices";
      assert.equal(uploadPath("5f0fedd8-95bc-4b07-95c5-28e9cf4795ac.png"), "/srv/giftvaly/uploads/5f0fedd8-95bc-4b07-95c5-28e9cf4795ac.png");
      // A row written before GV-11 ("storage/invoices/…") finds its file in INVOICE_DIR.
      assert.equal(invoicePdfPath("storage/invoices/GV-2607-0071-v1.pdf"), "/srv/giftvaly/invoices/GV-2607-0071-v1.pdf");
      assert.equal(invoicePdfPath("GV-2611-0001-v2.pdf"), "/srv/giftvaly/invoices/GV-2611-0001-v2.pdf");
      process.env.UPLOAD_DIR = "./public/uploads";
      assert.throws(() => uploadRoot(), /inside public\//);
    } finally {
      process.env.UPLOAD_DIR = before.u;
      process.env.INVOICE_DIR = before.i;
      if (before.u === undefined) delete process.env.UPLOAD_DIR;
      if (before.i === undefined) delete process.env.INVOICE_DIR;
    }
  });

  test("never inside public/ (Next serves it without a login)", () => {
    assert.throws(() => assertPrivateDir("UPLOAD_DIR", "/app/public", "/app"));
    assert.throws(() => assertPrivateDir("UPLOAD_DIR", "/app/public/uploads", "/app"));
    assert.equal(assertPrivateDir("UPLOAD_DIR", "/app/publications", "/app"), "/app/publications");
    assert.ok(!existsSync(path.join(ROOT, "public/uploads")));
  });

  test("only names the app writes resolve — no way out of the folder", () => {
    for (const bad of ["../.env", "..", "a/b.png", ".hidden.png", "x.svg", "x.pdf", "x.png/..", "%2e%2e.png"]) {
      assert.equal(uploadPath(bad), null, bad);
    }
    assert.equal(uploadUrlPath("/uploads/../../.env"), null);
    assert.equal(uploadUrlPath("https://evil.example/uploads/x.png"), null);
    assert.ok(uploadUrlPath("/uploads/invoice-logo-5f0fedd8-95bc-4b07-95c5-28e9cf4795ac.png"));
    for (const bad of ["../../etc/passwd", "storage/invoices/..", "x.pdf.exe", ""]) {
      assert.throws(() => invoicePdfPath(bad), bad);
    }
  });

  test("uploads are served by the signed-in route only; nothing writes to public/ any more", () => {
    const route = read("app/uploads/[...path]/route.ts");
    assert.match(route, /getServerSession\(authOptions\)/);
    assert.match(route, /status: 401/);
    for (const f of walk(path.join(ROOT, "app")).concat(walk(path.join(ROOT, "lib")))) {
      if (!/\.tsx?$/.test(f)) continue;
      const src = readFileSync(f, "utf8");
      assert.doesNotMatch(src, /"public",\s*"uploads"|storage\/invoices\/\$\{/, path.relative(ROOT, f));
    }
  });
});

describe("production bootstrap (GV-12)", () => {
  test("the demo seed refuses production", () => {
    assert.equal(databaseName("postgresql://giftvaly_owner:pw@localhost/giftvaly?host=/var/run/postgresql"), "giftvaly");
    assert.match(demoSeedRefusal({ NODE_ENV: "production" }) ?? "", /NODE_ENV/);
    assert.match(demoSeedRefusal({ DATABASE_URL: "postgresql://giftvaly_app:pw@localhost/giftvaly?host=/var/run/postgresql" }) ?? "", /DATABASE_URL/);
    assert.match(demoSeedRefusal({ DIRECT_URL: "postgresql://giftvaly_owner:pw@localhost/giftvaly" }) ?? "", /DIRECT_URL/);
    assert.equal(demoSeedRefusal({ DATABASE_URL: "postgresql://u:p@localhost/giftvaly_staging" }), null);
    assert.equal(demoSeedRefusal({ DATABASE_URL: "postgresql://u:p@ep-x-pooler.neon.tech/neondb?sslmode=require" }), null);
    assert.match(read("prisma/seed.ts"), /const refusal = demoSeedRefusal\(process\.env\);\n\s+if \(refusal\) \{\n\s+throw/);
  });

  test("the bootstrap creates no orders and never touches the order counter", () => {
    const boot = code(read("prisma/bootstrap.ts"));
    assert.doesNotMatch(boot, /\.(order|orderSequence|customer|product|package|wallet|team|lead|target|rewardRule)\.\w+\(/);
    assert.doesNotMatch(boot, /generateOrderNumber|deleteMany|\.delete\(/);
    assert.match(boot, /mustChangePassword: true/);
    const pkg = JSON.parse(read("package.json"));
    assert.equal(pkg.scripts["db:bootstrap"], "bash scripts/db-bootstrap.sh");
    assert.equal(pkg.engines.node, "24.x");
  });
});

describe(".env.example (GV-14)", () => {
  test("lists every production setting", () => {
    const env = read(".env.example");
    for (const key of [
      "DATABASE_URL", "DIRECT_URL", "NEXTAUTH_URL", "NEXTAUTH_SECRET", "INSTANCE_URL", "PLATFORM_SECRET", "SHARED_SIGNIN",
      "CRON_SECRET", "COURIER_ENCRYPTION_KEY", "UPLOAD_DIR", "INVOICE_DIR", "BACKUP_DIR", "BACKUP_RCLONE_REMOTE",
      "BACKUP_RETENTION_DAYS", "BACKUP_HOURLY_RETENTION_HOURS",
    ]) {
      assert.match(env, new RegExp(`^${key}=`, "m"), key);
    }
  });
});
