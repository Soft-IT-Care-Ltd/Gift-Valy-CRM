import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { signInUserWhere } from "@/lib/sign-in-user";
import { rejectUnlessPlatform } from "./auth";
import { applyBillingSnapshot } from "./billing";
import { applyPlatformPush } from "./state";
import { billingSnapshotSchema, platformPushSchema } from "./state-shape";
import type { Db } from "./tx";
import {
  MAX_USAGE_MONTHS,
  isYearMonth,
  usageRange,
  usageReport,
  yearMonthsBetween,
} from "./usage";

// FUNNEL_LINER.md GV-2…GV-5 — the /api/platform/* handlers. Machine-to-machine:
// PLATFORM_SECRET checked first, before the body is read; then Zod. They live
// here (the route files only bind them to prisma) so tests can run them
// inside a rolled-back transaction.

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: NO_STORE });

async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false };
  }
}

const firstIssue = (e: z.ZodError) => {
  const i = e.issues[0];
  return i ? `${i.path.join(".") || "body"}: ${i.message}` : "Invalid request";
};

// ---- GV-2: GET /api/platform/usage?from=YYMM&to=YYMM ----
const yymm = z.string().refine(isYearMonth, "YYMM, e.g. 2610");
const usageQuery = z
  .object({ from: yymm.optional(), to: yymm.optional() })
  .transform((q, ctx) => {
    const range = usageRange(q);
    if (range.from > range.to) ctx.addIssue({ code: "custom", message: "from is after to" });
    else if (yearMonthsBetween(range.from, range.to).length > MAX_USAGE_MONTHS)
      ctx.addIssue({ code: "custom", message: `At most ${MAX_USAGE_MONTHS} months at a time` });
    return range;
  });

export async function usageHandler(req: Request, db: Db = prisma) {
  const unauthorized = rejectUnlessPlatform(req);
  if (unauthorized) return unauthorized;
  const parsed = usageQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return json({ error: firstIssue(parsed.error) }, 400);
  return json(await usageReport(db, parsed.data));
}

// ---- GV-3: POST /api/platform/state ----
export async function stateHandler(req: Request, db: Db = prisma) {
  const unauthorized = rejectUnlessPlatform(req);
  if (unauthorized) return unauthorized;
  const body = await readJson(req);
  if (!body.ok) return json({ error: "Invalid JSON" }, 400);
  const parsed = platformPushSchema.safeParse(body.body);
  if (!parsed.success) return json({ error: firstIssue(parsed.error) }, 400);
  const { applied, state } = await applyPlatformPush(db, parsed.data);
  return json({
    ok: true,
    applied,
    state: state.state,
    changedAt: state.changedAt,
    sentAt: state.sentAt,
  });
}

// ---- GV-4: POST /api/platform/billing ----
export async function billingHandler(req: Request, db: Db = prisma) {
  const unauthorized = rejectUnlessPlatform(req);
  if (unauthorized) return unauthorized;
  const body = await readJson(req);
  if (!body.ok) return json({ error: "Invalid JSON" }, 400);
  const parsed = billingSnapshotSchema.safeParse(body.body);
  if (!parsed.success) return json({ error: firstIssue(parsed.error) }, 400);
  const { applied } = await applyBillingSnapshot(db, parsed.data);
  return json({ applied });
}

// ---- GV-5: POST /api/platform/has-user ----
// "Is this number yours?" — { found } and nothing else (no name, role or id).
// Read-only; never counts as a failed sign-in. The password never comes here.
// Same match as lib/auth.ts (lib/sign-in-user.ts).
const hasUserBody = z.object({ identifier: z.string().trim().min(1).max(255) });

export async function hasUserHandler(req: Request, db: Db = prisma) {
  const unauthorized = rejectUnlessPlatform(req);
  if (unauthorized) return unauthorized;
  const body = await readJson(req);
  if (!body.ok) return json({ error: "Invalid JSON" }, 400);
  const parsed = hasUserBody.safeParse(body.body);
  if (!parsed.success) return json({ error: "identifier is required" }, 400);
  const where = signInUserWhere(parsed.data.identifier);
  const user = where ? await db.user.findFirst({ where, select: { id: true } }) : null;
  return json({ found: user !== null });
}
