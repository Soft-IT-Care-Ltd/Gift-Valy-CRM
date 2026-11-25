// Verify R3 — a flood guard for POST /api/shop/order, checked BEFORE the
// database is asked anything: at most this many tries per visitor address
// per minute. The hourly order limits (Settings → Website) only count orders
// that were placed; a bot sending refused requests (an unknown item → 409)
// never reaches them, yet each try opens a transaction. In memory — the
// website runs as one process per copy (deploy/ecosystem*.config.cjs). Pure.

export const ORDER_TRIES_PER_MINUTE = 20;
const WINDOW_MS = 60_000;
const MAX_TRACKED = 20_000;

const tries = new Map<string, { start: number; count: number }>();

export function allowOrderTry(ip: string | null, now = Date.now()): boolean {
  const key = ip ?? "-";
  const t = tries.get(key);
  if (!t || now - t.start >= WINDOW_MS) {
    if (tries.size >= MAX_TRACKED) tries.clear();
    tries.set(key, { start: now, count: 1 });
    return true;
  }
  t.count += 1;
  return t.count <= ORDER_TRIES_PER_MINUTE;
}

export function resetOrderTries(): void {
  tries.clear();
}
