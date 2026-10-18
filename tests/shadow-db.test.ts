// CLAUDE.md rule 8 — the shadow guard. Run: npm run test:shadow-db
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assertShadowDatabaseUrl } from "../lib/shadow-db";

const REAL = "postgresql://u:p@ep-x-pooler.ap.aws.neon.tech/giftvaly?sslmode=require";
const DIRECT = "postgresql://u:p@ep-x.ap.aws.neon.tech/giftvaly?sslmode=require";

test("accepts a *_shadow database", () => {
  assertShadowDatabaseUrl("postgresql://u:p@ep-x.ap.aws.neon.tech/giftvaly_shadow?sslmode=require", [REAL, DIRECT]);
});

test("refuses when unset or blank", () => {
  assert.throws(() => assertShadowDatabaseUrl(undefined, [REAL]), /not set/);
  assert.throws(() => assertShadowDatabaseUrl("  ", [REAL]), /not set/);
});

test("refuses a name that does not end in _shadow", () => {
  assert.throws(() => assertShadowDatabaseUrl(DIRECT, []), /does not end in "_shadow"/);
  assert.throws(() => assertShadowDatabaseUrl("postgresql://u:p@h/giftvaly_shadow_old", []), /_shadow/);
  assert.throws(() => assertShadowDatabaseUrl("postgresql://u:p@h/shadow", []), /_shadow/);
});

test("refuses the same database as DATABASE_URL / DIRECT_URL", () => {
  const shadowAsReal = "postgresql://u:p@ep-x.ap.aws.neon.tech/giftvaly_shadow";
  assert.throws(
    () => assertShadowDatabaseUrl(shadowAsReal, ["postgresql://a:b@ep-x-pooler.ap.aws.neon.tech/giftvaly_shadow"]),
    /same database/,
  );
});

test("refuses garbage", () => {
  assert.throws(() => assertShadowDatabaseUrl("not a url", []), /not a valid URL/);
});

test("schema wires shadowDatabaseUrl to SHADOW_DATABASE_URL", () => {
  const schema = readFileSync(path.resolve(__dirname, "../prisma/schema.prisma"), "utf8");
  assert.match(schema, /shadowDatabaseUrl\s*=\s*env\("SHADOW_DATABASE_URL"\)/);
});
