// CLAUDE.md rule 6 / FUNNEL_LINER.md GV-1 — order_sequences is the billing
// record, so every GV- number this app hands out must come from
// generateOrderNumber(tx) inside the transaction that writes it. This reads
// the source: a new way to create an order, a hand-made number, or a write
// to the counter anywhere else fails here before it can reach a bill.
// Run: npm run test:order-paths
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function walk(dir: string, out: { rel: string; text: string }[] = []) {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push({ rel, text: readFileSync(path.join(ROOT, rel), "utf8") });
  }
  return out;
}

const APP = [...walk("app"), ...walk("lib")];
const SEED = { rel: "prisma/seed.ts", text: readFileSync(path.join(ROOT, "prisma/seed.ts"), "utf8") };
const SCRIPTS = walk("scripts");
const EVERYTHING = [...APP, SEED, ...SCRIPTS];

/** text[open] is "(" or "{": the text up to and including its matching close. */
function balanced(text: string, open: number): string {
  const close = text[open] === "(" ? ")" : "}";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === text[open]) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

/** An object literal with its nested objects blanked out — only its own keys remain. */
function topLevel(obj: string): string {
  let depth = 0;
  let out = "";
  for (const ch of obj) {
    if (ch === "{") depth++;
    if (depth <= 1) out += ch;
    if (ch === "}") depth--;
  }
  return out;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

/** The top-level keys of a call's `data: { … }`. */
function dataKeys(call: string): string {
  const at = call.search(/\bdata\s*:\s*\{/);
  assert.ok(at >= 0, "call has a data: { … } object");
  return topLevel(balanced(call, call.indexOf("{", at)));
}

// A string that starts an order-shaped number: "GV-2610-…", `GV-${ym}-…`,
// "GV-LIFECYCLE-…". (Product SKUs are GV-NNNN — one dash — and don't match.)
const GV_ORDER_NO = /["'`]GV-[A-Z0-9]*-|["'`]GV-\$\{[^}]*\}-/g;

const SHORTHAND_ORDER_NO = /\{\s*orderNo\s*,|,\s*orderNo\s*[,}]/;

// The one place the number is handed out, on that same client, just before
// the write. `drafts` allows the create route's DRAFT-or-GV ternary.
function assertNumberedJustBefore(text: string, index: number, client: string, drafts: boolean) {
  const before = text.slice(Math.max(0, index - 300), index);
  const gv = String.raw`await\s+generateOrderNumber\(\s*${client}\s*[,)]`;
  const draft = String.raw`await\s+nextDraftNo\(\s*${client}\s*\)`;
  const re = drafts
    ? new RegExp(String.raw`const\s+orderNo\s*=\s*[^;]*\?\s*${draft}\s*:\s*${gv}`, "g")
    : new RegExp(String.raw`const\s+orderNo\s*=\s*${gv}`, "g");
  const m = [...before.matchAll(re)].at(-1);
  assert.ok(m, `orderNo must come from generateOrderNumber(${client}) right before the write`);
  assert.doesNotMatch(before.slice(m.index!), /\.order\.(create|update)/);
}

describe("rule 6 — every GV number comes from generateOrderNumber", () => {
  test("app + lib create orders in exactly one place: the order form route, inside a transaction", () => {
    const inserts: string[] = [];
    for (const { rel, text } of APP) {
      for (const m of text.matchAll(/\.order\.(create|createMany|createManyAndReturn|upsert)\s*\(/g)) {
        inserts.push(`${rel} ${m[1]}`);
      }
      if (/insert\s+into\s+"?orders"?\s*[(\s]/i.test(text)) inserts.push(`${rel} raw sql`);
    }
    assert.deepEqual(inserts, ["app/api/orders/route.ts create"]);
  });

  test("the order form numbers the order (DRAFT-XXXX or the counter) in the same transaction", () => {
    const text = APP.find((f) => f.rel === "app/api/orders/route.ts")!.text;
    const index = text.search(/\.order\.create\s*\(/);
    const client = /(\w+)$/.exec(text.slice(0, index))![1];
    assert.equal(client, "tx", "created on the transaction client, never the root prisma");
    assertNumberedJustBefore(text, index, client, true);
    const data = dataKeys(balanced(text, text.indexOf("(", index)));
    assert.match(data, SHORTHAND_ORDER_NO);
    assert.doesNotMatch(data, /\borderNo\s*:/);
  });

  test("an order number changes only when confirmDraftTx gives a draft its counter number", () => {
    const writes: string[] = [];
    for (const { rel, text } of APP) {
      for (const m of text.matchAll(/\.order\.(update|updateMany|upsert)\s*\(/g)) {
        const call = balanced(text, text.indexOf("(", m.index!));
        for (const d of call.matchAll(/\b(data|create|update)\s*:\s*\{/g)) {
          if (/\borderNo\b/.test(topLevel(balanced(call, call.indexOf("{", d.index!))))) {
            writes.push(`${rel}:${lineOf(text, m.index!)}`);
          }
        }
      }
      if (/update\s+"?orders"?\s+set[^;]*order_no\s*=/i.test(text)) writes.push(`${rel} (raw SQL)`);
    }
    assert.equal(writes.length, 1, `orderNo writes: ${writes.join(", ")}`);
    assert.match(writes[0], /^lib\/orders\.ts:\d+$/);

    const text = APP.find((f) => f.rel === "lib/orders.ts")!.text;
    const fnAt = text.indexOf("export async function confirmDraftTx(");
    const sig = /\)\s*:\s*Promise<[^>]*>\s*\{/.exec(text.slice(fnAt))!;
    const fn = balanced(text, fnAt + sig.index + sig[0].length - 1);
    const index = text.indexOf(fn) + fn.search(/\.order\.update\s*\(\s*\{[^]*?\borderNo\b/);
    const client = /(\w+)$/.exec(text.slice(0, index))![1];
    assert.equal(client, "tx");
    assertNumberedJustBefore(text, index, client, false);
    assert.match(dataKeys(balanced(text, text.indexOf("(", index))), SHORTHAND_ORDER_NO);
  });

  test("app code never backdates a number — only the demo seed passes a date", () => {
    for (const { rel, text } of APP) {
      for (const m of text.matchAll(/generateOrderNumber\(([^)]*)\)/g)) {
        if (rel === "lib/order-number.ts") continue;
        assert.match(m[1], /^\s*tx\s*$/, `${rel}:${lineOf(text, m.index!)} passes more than tx`);
      }
    }
  });

  test("no 'last row + 1' or hand-made GV number anywhere", () => {
    const offenders: string[] = [];
    for (const { rel, text } of APP) {
      if (rel === "lib/order-number.ts") continue;
      if (/\bnextOrderNo\b|\borderNoPrefix\b/.test(text)) offenders.push(`${rel} (old helper)`);
      for (const m of text.matchAll(GV_ORDER_NO)) offenders.push(`${rel}:${lineOf(text, m.index!)}`);
    }
    // The seed numbers through the counter too; scripts use TEST- numbers.
    for (const { rel, text } of [SEED, ...SCRIPTS]) {
      for (const m of text.matchAll(GV_ORDER_NO)) offenders.push(`${rel}:${lineOf(text, m.index!)}`);
      if (/\bnextOrderNoFor\b/.test(text)) offenders.push(`${rel} (old helper)`);
    }
    assert.deepEqual(offenders, []);
    assert.match(SEED.text, /generateOrderNumber\(tx,/);
    assert.match(SEED.text, /process\.env\.NODE_ENV === "production"[^]{0,40}throw/);
  });

  test("only generateOrderNumber ever writes order_sequences, and it only counts up", () => {
    const writers: string[] = [];
    for (const { rel, text } of EVERYTHING) {
      for (const m of text.matchAll(/\.orderSequence\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g)) {
        writers.push(`${rel}:${lineOf(text, m.index!)} ${m[1]}`);
      }
      for (const m of text.matchAll(/(update|delete\s+from|truncate|insert\s+into|drop\s+table)\s+"?order_sequences"?/gi)) {
        writers.push(`${rel}:${lineOf(text, m.index!)} ${m[1].toLowerCase()}`);
      }
    }
    assert.equal(writers.length, 1, `writers: ${writers.join(", ")}`);
    assert.match(writers[0], /^lib\/order-number\.ts:\d+ insert into$/);
    const gen = readFileSync(path.join(ROOT, "lib/order-number.ts"), "utf8");
    assert.match(gen, /ON CONFLICT \("year_month"\) DO UPDATE\s+SET "last_number" = "order_sequences"\."last_number" \+ 1/);
    assert.match(gen, /tx: Prisma\.TransactionClient/);
  });

  test("only the migration that created order_sequences mentions it, and it never lowers a row", () => {
    const dir = path.join(ROOT, "prisma/migrations");
    const touching = readdirSync(dir)
      .filter((d) => statSync(path.join(dir, d)).isDirectory())
      .sort()
      .filter((d) => /order_sequences/i.test(readFileSync(path.join(dir, d, "migration.sql"), "utf8")));
    assert.equal(touching.length, 1, `migrations: ${touching.join(", ")}`);
    const sql = readFileSync(path.join(dir, touching[0], "migration.sql"), "utf8").replace(/--.*$/gm, "");
    assert.doesNotMatch(sql, /delete\s+from|truncate|drop\s+table|alter\s+table\s+"?order_sequences/i);
    // The backfill's only UPDATE is the never-lower GREATEST on conflict.
    for (const m of sql.matchAll(/\bset\b([^;]*)/gi)) assert.match(m[1], /GREATEST/);
  });
});
