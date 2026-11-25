import type { MetaEvent, Prisma } from "@prisma/client";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { storefrontOrigin } from "@/lib/storefront/hosts";
import { queuePurchase } from "./orders";
import { META_MAX_EVENT_AGE_MS } from "./shared";
import { getMetaConfig, type MetaConfig } from "./config";

// ROUND3 W-8 — sending the queued events to Meta's Conversions API. Nothing
// here runs inside an order's request path: the order (or the confirmation)
// commits first, then the event is sent right after the response
// (`sendSoon`), and the meta-events job (every 5 minutes) sends whatever is
// still waiting and retries failures with growing gaps. A failure is logged
// with Meta's answer and never touches the order.

export const GRAPH_API_VERSION = "v23.0";
const GRAPH = "https://graph.facebook.com";

/** Minutes before the next try after the 1st, 2nd, … failure; then FAILED (an Admin can see it in the event log). */
export const RETRY_MINUTES = [1, 5, 15, 60, 180];
/** A row being sent is held this long, so two senders never send it twice. */
const LEASE_MS = 2 * 60_000;

type Db = Prisma.TransactionClient | typeof prisma;

export type MetaHttpResult = { status: number; body: unknown };
export type MetaTransport = (url: string, body: unknown) => Promise<MetaHttpResult>;

const fetchTransport: MetaTransport = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

let transport: MetaTransport = fetchTransport;

/** Tests only: the network is never reached from a test. */
export function setMetaTransport(t: MetaTransport | null): void {
  transport = t ?? fetchTransport;
}

/** Run after the response is sent; outside a request (tests, scripts) the job sends it instead. */
export function sendSoon(fn: () => Promise<unknown>): void {
  try {
    after(async () => {
      try {
        await fn();
      } catch (e) {
        console.error("Meta tracking: background send failed —", e);
      }
    });
  } catch {
    // Not inside a request: the meta-events job picks it up.
  }
}

type MetaAnswer = {
  events_received?: number;
  fbtrace_id?: string;
  error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string };
};

function describeError(result: MetaHttpResult | null, thrown: unknown): string {
  if (thrown) return `Couldn't reach Meta: ${thrown instanceof Error ? thrown.message : String(thrown)}`.slice(0, 500);
  const err = (result?.body as MetaAnswer | null)?.error;
  if (err) {
    return `${err.error_user_msg || err.message || "Meta refused the event"}${err.code ? ` (code ${err.code}${err.error_subcode ? `/${err.error_subcode}` : ""})` : ""}`.slice(0, 500);
  }
  return `Meta answered HTTP ${result?.status ?? "?"}`;
}

async function sendRow(db: Db, row: MetaEvent, config: MetaConfig, now: Date): Promise<"SENT" | "PENDING" | "FAILED" | "SKIPPED"> {
  if (now.getTime() - row.eventTime.getTime() > META_MAX_EVENT_AGE_MS) {
    await db.metaEvent.update({ where: { id: row.id }, data: { status: "SKIPPED", nextAttemptAt: null, error: "More than 7 days old — Meta doesn't accept events that old" } });
    return "SKIPPED";
  }
  const body: Record<string, unknown> = { data: [row.payload], access_token: config.token };
  if (row.testEventCode) body.test_event_code = row.testEventCode;
  let result: MetaHttpResult | null = null;
  let thrown: unknown = null;
  try {
    result = await transport(`${GRAPH}/${GRAPH_API_VERSION}/${row.pixelId}/events`, body);
  } catch (e) {
    thrown = e;
  }
  const answer = (result?.body ?? null) as MetaAnswer | null;
  const attempts = row.attempts + 1;
  // Meta's answer — never the token.
  const response = (answer ?? (thrown ? { error: { message: String(thrown) } } : null)) as Prisma.InputJsonValue | null;
  if (result && result.status >= 200 && result.status < 300 && (answer?.events_received ?? 0) >= 1) {
    await db.metaEvent.update({ where: { id: row.id }, data: { status: "SENT", attempts, sentAt: now, nextAttemptAt: null, response: response ?? undefined, error: null } });
    return "SENT";
  }
  const giveUp = attempts > RETRY_MINUTES.length;
  await db.metaEvent.update({
    where: { id: row.id },
    data: {
      status: giveUp ? "FAILED" : "PENDING",
      attempts,
      nextAttemptAt: giveUp ? null : new Date(now.getTime() + RETRY_MINUTES[attempts - 1] * 60_000),
      response: response ?? undefined,
      error: describeError(result, thrown),
    },
  });
  return giveUp ? "FAILED" : "PENDING";
}

export type FlushResult = { sent: number; retrying: number; failed: number; skipped: number };

/** Send what is due (or just `ids`). Each row is claimed first, so the job and a background send never send one twice. */
export async function flushMetaEvents(db: Db = prisma, opts: { ids?: number[]; limit?: number; now?: Date } = {}): Promise<FlushResult> {
  const now = opts.now ?? new Date();
  const result: FlushResult = { sent: 0, retrying: 0, failed: 0, skipped: 0 };
  const due: Prisma.MetaEventWhereInput = {
    status: "PENDING",
    OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    ...(opts.ids ? { id: { in: opts.ids } } : {}),
  };
  const config = await getMetaConfig(db);
  if (!config) {
    // Switched off (or the token is gone): what was waiting is not sent later by surprise.
    const { count } = await db.metaEvent.updateMany({ where: due, data: { status: "SKIPPED", nextAttemptAt: null, error: "Tracking was switched off before it was sent" } });
    result.skipped = count;
    return result;
  }
  const rows = await db.metaEvent.findMany({ where: due, orderBy: { createdAt: "asc" }, take: opts.limit ?? 100 });
  for (const row of rows) {
    const claimed = await db.metaEvent.updateMany({
      where: { id: row.id, status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
    });
    if (claimed.count !== 1) continue;
    const outcome = await sendRow(db, row, config, now);
    if (outcome === "SENT") result.sent += 1;
    else if (outcome === "PENDING") result.retrying += 1;
    else if (outcome === "FAILED") result.failed += 1;
    else result.skipped += 1;
  }
  return result;
}

/**
 * Website orders confirmed in the last 7 days, captured at placement, with no
 * Purchase yet (a confirmation whose queueing failed, or tracking switched
 * back on) get it now. Still at most once per order.
 */
export async function sweepConfirmedPurchases(db: Db = prisma, now = new Date()): Promise<number> {
  if (!(await getMetaConfig(db))) return 0;
  const orders = await db.order.findMany({
    where: {
      metaSignal: { placedAt: { gte: new Date(now.getTime() - META_MAX_EVENT_AGE_MS) } },
      metaEvents: { none: { eventName: "Purchase" } },
      statusHistory: { some: { fromStatus: "DRAFT", toStatus: "CONFIRMED" } },
    },
    select: { id: true },
    take: 200,
  });
  let queued = 0;
  for (const o of orders) if ((await queuePurchase(db, o.id, now)) === "queued") queued += 1;
  return queued;
}

const daysAgo = (now: Date, n: number) => new Date(now.getTime() - n * 86_400_000);

/** Browsing events are kept 30 days, order events 180; what was captured at placement, 30 days. */
export async function purgeMetaEvents(db: Db = prisma, now = new Date()): Promise<number> {
  const browse = await db.metaEvent.deleteMany({ where: { orderId: null, createdAt: { lt: daysAgo(now, 30) }, status: { not: "PENDING" } } });
  const orders = await db.metaEvent.deleteMany({ where: { orderId: { not: null }, createdAt: { lt: daysAgo(now, 180) }, status: { not: "PENDING" } } });
  const signals = await db.metaOrderSignal.deleteMany({ where: { placedAt: { lt: daysAgo(now, 30) } } });
  return browse.count + orders.count + signals.count;
}

/**
 * Settings → "Send test event": one PageView to Meta's Test Events tab (the
 * test code is required, so nothing reaches real reporting), sent now with
 * Meta's answer shown. Works before tracking is switched on, to check the
 * Pixel ID and token.
 */
export async function sendMetaTestEvent(db: Db, input: { ip: string | null; userAgent: string | null; now?: Date }) {
  const now = input.now ?? new Date();
  const config = await getMetaConfig(db, { evenWhenOff: true });
  if (!config) return { ok: false as const, error: "Save the Pixel ID and the Conversions API token first." };
  if (!config.testEventCode) return { ok: false as const, error: "Enter the test event code from Meta's Test Events tab first — a test event never goes to real reporting." };
  const eventId = `test.${now.getTime().toString(36)}`;
  const row = await db.metaEvent.create({
    data: {
      eventName: "PageView",
      eventId,
      eventTime: now,
      pixelId: config.pixelId,
      testEventCode: config.testEventCode,
      payload: {
        event_name: "PageView",
        event_time: Math.floor(now.getTime() / 1000),
        event_id: eventId,
        action_source: "website",
        event_source_url: `${storefrontOrigin()}/`,
        user_data: { ...(input.ip ? { client_ip_address: input.ip } : {}), client_user_agent: (input.userAgent ?? "Gift Valy ERP test").slice(0, 500) },
      },
    },
  });
  const outcome = await sendRow(db, row, config, now);
  const sent = await db.metaEvent.findUniqueOrThrow({ where: { id: row.id }, select: { response: true, error: true } });
  if (outcome === "SENT") return { ok: true as const, response: sent.response };
  // A test is one try: no retries queued behind the Admin's back.
  await db.metaEvent.update({ where: { id: row.id }, data: { status: "FAILED", nextAttemptAt: null } });
  return { ok: false as const, error: sent.error ?? "Meta refused the test event", response: sent.response };
}
