// FUNNEL_LINER.md GV-2…GV-5 against the dev database. Every test runs the real
// route handler inside ONE transaction that is rolled back at the end, so the
// database (settings, audit_logs, order_sequences, users) is left untouched.
// It creates no orders: usage is checked against the counter and the rows
// already there (plus a rolled-back counter row for the far-future 9901).
// Run: npm run test:platform (needs DATABASE_URL).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  billingHandler,
  hasUserHandler,
  stateHandler,
  usageHandler,
} from "../lib/platform/handlers";
import { PLATFORM_BILLING_KEY, PLATFORM_STATE_KEY } from "../lib/platform/state-shape";
import { FUNNEL_LINER_USER_EMAIL } from "../lib/system-user";
import { dhakaYearMonth } from "../lib/order-number";
import { checkUserPhone } from "../lib/user-phone-db";
import { validSnapshot } from "./fixtures/platform";

const prisma = new PrismaClient();
const SECRET = "integration-platform-secret";
const AUTH = `Bearer ${SECRET}`;
const ROLLBACK = new Error("rollback");

before(() => {
  process.env.PLATFORM_SECRET = SECRET;
});
after(() => prisma.$disconnect());

/** Run `fn` in a transaction that never commits. */
async function inRollback(fn: (tx: Prisma.TransactionClient) => Promise<void>) {
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    }, { timeout: 60_000, maxWait: 20_000 }),
    (e) => e === ROLLBACK
  );
}

const post = (url: string, body: unknown) =>
  new Request(`http://localhost:3000${url}`, {
    method: "POST",
    headers: { authorization: AUTH, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const get = (url: string) =>
  new Request(`http://localhost:3000${url}`, { headers: { authorization: AUTH } });

describe("GV-2 usage", () => {
  test("ordersCreated is order_sequences.lastNumber; counts and numbers only", async () => {
    await inRollback(async (tx) => {
      const seqs = await tx.orderSequence.findMany({ orderBy: { yearMonth: "asc" } });
      const ym = seqs.at(-1)?.yearMonth ?? dhakaYearMonth();
      const res = await usageHandler(get(`/api/platform/usage?from=${ym}&to=${ym}`), tx);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(Object.keys(body).sort(), ["months", "serverTime", "state", "version"]);
      assert.equal(typeof body.state, "string");
      const [m] = body.months;
      const n = seqs.find((s) => s.yearMonth === ym)?.lastNumber ?? 0;
      assert.equal(m.ordersCreated, n);
      assert.equal(m.lastOrderNo, n ? `GV-${ym}-${String(n).padStart(4, "0")}` : null);
      assert.deepEqual(Object.keys(m.breakdown).sort(), ["cancelled", "confirmedAndLater", "draftsNotConfirmed", "inTrash", "onHold"]);
      // Information only: rows that still exist never exceed the counter.
      const b = m.breakdown;
      assert.ok(b.confirmedAndLater + b.onHold + b.cancelled + b.inTrash <= m.ordersCreated);
      // Nothing personal or monetary in the payload.
      assert.doesNotMatch(JSON.stringify(body), /name|phone|address|price|amount|cost|paid/i);
    });
  });

  test("the counter, not the rows: a bumped counter is billed; a month with no row is 0", async () => {
    await inRollback(async (tx) => {
      await tx.orderSequence.upsert({
        where: { yearMonth: "9901" },
        create: { yearMonth: "9901", lastNumber: 7 },
        update: {},
      });
      const res = await usageHandler(get("/api/platform/usage?from=9812&to=9901"), tx);
      const { months } = await res.json();
      assert.deepEqual(
        months.map((m: { yearMonth: string; ordersCreated: number; lastOrderNo: string | null }) => [m.yearMonth, m.ordersCreated, m.lastOrderNo]),
        [["9812", 0, null], ["9901", 7, "GV-9901-0007"]]
      );
    });
  });

  test("no query = the previous and the current Dhaka month", async () => {
    await inRollback(async (tx) => {
      const res = await usageHandler(get("/api/platform/usage"), tx);
      const { months } = await res.json();
      assert.equal(months.length, 2);
      assert.equal(months[1].yearMonth, dhakaYearMonth());
    });
  });
});

// Rows this test wrote: after the last id at its start (a time window would
// also catch real pushes made to the dev server a moment earlier).
const lastAuditId = async (tx: Prisma.TransactionClient) =>
  (await tx.auditLog.findFirst({ orderBy: { id: "desc" }, select: { id: true } }))?.id ?? 0;

async function auditRows(tx: Prisma.TransactionClient, action: string, afterId: number) {
  return tx.auditLog.findMany({
    where: { action, id: { gt: afterId } },
    include: { user: { select: { email: true, isActive: true } } },
    orderBy: { id: "asc" },
  });
}

describe("GV-3 state", () => {
  test("applies, audits as Funnel Liner, ignores an older push, keeps changedAt on a repeat", async () => {
    await inRollback(async (tx) => {
      await tx.setting.deleteMany({ where: { key: PLATFORM_STATE_KEY } });
      const since = await lastAuditId(tx);

      let res = await stateHandler(post("/api/platform/state", {
        state: "past_due", amountDue: "৳3,800", dueOn: "2099-11-07", sentAt: "2099-11-01T01:00:00+06:00",
      }), tx);
      assert.equal(res.status, 200);
      let body = await res.json();
      assert.equal(body.applied, true);
      assert.equal(body.state, "past_due");
      const firstChangedAt = body.changedAt;

      // Same state again, newer: applied, changedAt kept.
      res = await stateHandler(post("/api/platform/state", { state: "past_due", sentAt: "2099-11-02T01:00:00+06:00" }), tx);
      body = await res.json();
      assert.equal(body.applied, true);
      assert.equal(body.changedAt, firstChangedAt);

      // Older push: ignored, state unchanged.
      res = await stateHandler(post("/api/platform/state", { state: "active", sentAt: "2099-10-31T01:00:00+06:00" }), tx);
      body = await res.json();
      assert.equal(body.applied, false);
      assert.equal(body.state, "past_due");

      const stored = await tx.setting.findUnique({ where: { key: PLATFORM_STATE_KEY } });
      assert.equal((stored!.value as { state: string }).state, "past_due");

      const rows = await auditRows(tx, "platform.state", since);
      assert.equal(rows.length, 2, "one audit row per applied push, none for the ignored one");
      for (const r of rows) {
        assert.equal(r.user.email, FUNNEL_LINER_USER_EMAIL);
        assert.equal(r.user.isActive, false);
        assert.equal((r.afterJson as { actor: string }).actor, "Funnel Liner");
        assert.equal((r.beforeJson as { actor: string }).actor, "Funnel Liner");
      }
    });
  });
});

describe("GV-4 billing snapshot", () => {
  test("stored whole, audited, an older sentAt ignored", async () => {
    await inRollback(async (tx) => {
      await tx.setting.deleteMany({ where: { key: PLATFORM_BILLING_KEY } });
      const since = await lastAuditId(tx);
      const snap = validSnapshot();

      let res = await billingHandler(post("/api/platform/billing", snap), tx);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { applied: true });

      const stored = (await tx.setting.findUnique({ where: { key: PLATFORM_BILLING_KEY } }))!.value as typeof snap;
      assert.equal(stored.invoices[0].totalPaisa, 380000);
      assert.equal(stored.payTo.note, snap.payTo.note);

      res = await billingHandler(post("/api/platform/billing", { ...snap, sentAt: "2026-10-01T00:00:00+06:00", invoices: [] }), tx);
      assert.deepEqual(await res.json(), { applied: false });
      const still = (await tx.setting.findUnique({ where: { key: PLATFORM_BILLING_KEY } }))!.value as typeof snap;
      assert.equal(still.invoices.length, 1);

      const rows = await auditRows(tx, "platform.billing", since);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].user.email, FUNNEL_LINER_USER_EMAIL);
      assert.equal((rows[0].afterJson as { actor: string }).actor, "Funnel Liner");
    });
  });
});

describe("GV-5 has-user", () => {
  test("found for exactly the people who can sign in, by phone or email; nothing else answered", async () => {
    await inRollback(async (tx) => {
      const role = await tx.role.findFirstOrThrow({ select: { id: true } });
      const mk = (email: string, phone: string, isActive: boolean) =>
        tx.user.create({ data: { name: "GV5 test", email, phone, passwordHash: "x", roleId: role.id, isActive } });
      await mk("gv5-active@test.local", "01799000001", true);
      await mk("gv5-inactive@test.local", "01799000002", false);

      const ask = async (identifier: string) => {
        const res = await hasUserHandler(post("/api/platform/has-user", { identifier }), tx);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.deepEqual(Object.keys(body), ["found"]);
        return body.found as boolean;
      };
      assert.equal(await ask("01799000001"), true);
      assert.equal(await ask("+880 1799-000001"), true);
      assert.equal(await ask("GV5-Active@Test.Local"), true);
      assert.equal(await ask("01799000002"), false, "deactivated");
      assert.equal(await ask("gv5-inactive@test.local"), false, "deactivated");
      assert.equal(await ask("01799000009"), false, "unknown");
      assert.equal(await ask(FUNNEL_LINER_USER_EMAIL), false, "system user");

      // A phone stored in another spelling (seed, bootstrap, a hand fix) and an
      // email stored with capitals are still found by what the shared sign-in
      // page sends: 01XXXXXXXXX and a lower-cased email.
      await mk("GV5-Caps@Test.Local", "+8801799000003", true);
      await mk("gv5-intl@test.local", "8801799000004", true);
      assert.equal(await ask("01799000003"), true, "+8801… stored");
      assert.equal(await ask("01799000004"), true, "8801… stored");
      assert.equal(await ask("gv5-caps@test.local"), true, "capitals stored");
    });
  });

  test("users.phone is unique (users_phone_key)", async () => {
    await inRollback(async (tx) => {
      const role = await tx.role.findFirstOrThrow({ select: { id: true } });
      const data = { name: "dup", passwordHash: "x", roleId: role.id, phone: "01799000003" };
      await tx.user.create({ data: { ...data, email: "gv5-dup1@test.local" } });
      await assert.rejects(
        tx.user.create({ data: { ...data, email: "gv5-dup2@test.local" } }),
        (e: { code?: string }) => e.code === "P2002"
      );
    });
  });

  test("the user form normalises a phone and refuses a duplicate or a non-phone", async () => {
    await inRollback(async (tx) => {
      const role = await tx.role.findFirstOrThrow({ select: { id: true } });
      const holder = await tx.user.create({
        data: { name: "GV5 holder", email: "gv5-holder@test.local", phone: "01799000004", passwordHash: "x", roleId: role.id },
      });
      const dup = await checkUserPhone(tx, "+8801799000004");
      assert.ok("error" in dup);
      assert.equal(dup.error.status, 409);
      assert.match((await dup.error.json()).error, /already used by GV5 holder/);
      // Saving the holder's own phone again is not a duplicate.
      assert.deepEqual(await checkUserPhone(tx, "8801799000004", holder.id), { phone: "01799000004" });
      const bad = await checkUserPhone(tx, "12ab");
      assert.ok("error" in bad && bad.error.status === 400);
      assert.deepEqual(await checkUserPhone(tx, ""), { phone: null });
      assert.deepEqual(await checkUserPhone(tx, undefined), { phone: undefined });
    });
  });
});
