import { prisma } from "@/lib/db";
import { applySettingsPush } from "./settings-push";
import {
  ACTIVE_STATE,
  PLATFORM_STATE_KEY,
  parseStoredState,
  type PlatformPush,
  type PlatformState,
} from "./state-shape";
import type { Db } from "./tx";

// FUNNEL_LINER.md GV-3 — the state Funnel Liner pushed, stored in `settings`
// (no new table) and read through one small cache. Gift Valy never calls
// Funnel Liner; with nothing pushed it is "active". If the database can't be
// read, the last known state stands ("active" when there is none) — this
// never locks anyone out by accident.

const CACHE_MS = 5_000;

// Per server process: the proxy and the route handlers may each hold a copy,
// which is why the cache is only a few seconds long — a push reaches all of
// them within CACHE_MS, with no restart.
let cached: { state: PlatformState; at: number } | null = null;

/** The current state, at most CACHE_MS old — for the proxy gate and banners. */
export async function getPlatformState(now = Date.now()): Promise<PlatformState> {
  if (cached && now - cached.at < CACHE_MS) return cached.state;
  try {
    const row = await prisma.setting.findUnique({ where: { key: PLATFORM_STATE_KEY } });
    cached = { state: parseStoredState(row?.value), at: now };
  } catch (e) {
    console.error("Platform state unreadable — keeping the last known one:", e);
    cached = { state: cached?.state ?? ACTIVE_STATE, at: now };
  }
  return cached.state;
}

/** Uncached — the usage endpoint and Settings show the stored truth. */
export async function readPlatformState(db: Db): Promise<PlatformState> {
  const row = await db.setting.findUnique({ where: { key: PLATFORM_STATE_KEY } });
  return parseStoredState(row?.value);
}

export function forgetCachedPlatformState(): void {
  cached = null;
}

export const PLATFORM_STATE_AUDIT_ACTION = "platform.state";

/** Store a push (GV-3). An older push is ignored: { applied: false }. */
export async function applyPlatformPush(
  db: Db,
  push: PlatformPush,
  now = new Date()
): Promise<{ applied: boolean; state: PlatformState }> {
  const { applied, value } = await applySettingsPush<PlatformState>(db, {
    key: PLATFORM_STATE_KEY,
    action: PLATFORM_STATE_AUDIT_ACTION,
    pushSentAt: push.sentAt,
    // "Nothing ever pushed" reads as null here, so the first push always applies.
    parse: (raw) => (raw == null ? null : parseStoredState(raw)),
    build: (before) => ({
      state: push.state,
      message: push.message || null,
      amountDue: push.amountDue || null,
      dueOn: push.dueOn || null,
      sentAt: new Date(push.sentAt).toISOString(),
      changedAt:
        before && before.state === push.state && before.changedAt
          ? before.changedAt
          : now.toISOString(),
    }),
  });
  if (applied) forgetCachedPlatformState();
  return { applied, state: value ?? ACTIVE_STATE };
}
