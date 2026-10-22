import { NextResponse } from "next/server";
import { getPlatformState } from "./state";
import { LOCK_CODE, LOCK_ERROR, lockVerdict } from "./lock";
import type { PlatformStateName } from "./state-shape";

// FUNNEL_LINER.md GV-7 — the billing lock, called by proxy.ts for every
// request before any page or route runs (kept here so it can be tested
// without Next's runtime). Null lets the request through; otherwise the
// redirect or the 423 to send. Open paths never wait for the state; every
// other request reads it through the 5 s cache (lib/platform/state.ts), so a
// push applies at once with no restart and there is no query per request.
// No session is read: a locked page goes to /billing, and the dashboard
// layout sends a signed-out person from there to /login.

export async function billingLockGate(
  method: string,
  url: URL,
  readState: () => Promise<{ state: PlatformStateName }> = getPlatformState
): Promise<NextResponse | null> {
  const verdict = lockVerdict(method, url.pathname);
  if (verdict === "open") return null;
  if ((await readState()).state !== "suspended") return null;
  if (verdict === "redirect") {
    return NextResponse.redirect(new URL("/billing", url), { status: 307 });
  }
  return NextResponse.json(
    { error: LOCK_ERROR, code: LOCK_CODE },
    { status: 423, headers: { "Cache-Control": "no-store" } }
  );
}
