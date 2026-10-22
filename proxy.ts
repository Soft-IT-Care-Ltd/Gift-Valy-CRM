import { NextResponse, type NextRequest } from "next/server";
import { billingLockGate } from "@/lib/platform/gate";

// FUNNEL_LINER.md GV-7 — the billing lock is enforced here and nowhere else.
// Every request passes this point before any page or route runs (Next 16's
// proxy, Node.js runtime). While Funnel Liner has the ERP "suspended", every
// page goes to /billing and every API route answers 423, except what
// lib/platform/lock.ts lists as open, with its reason. "past_due" and
// "active" lock nothing. Machine routes (/api/platform/*, /api/cron/*,
// /api/webhooks/*) carry no session and need none here: each checks its own
// secret, as before.
export default async function proxy(req: NextRequest) {
  const locked = await billingLockGate(req.method, req.nextUrl);
  return locked ?? NextResponse.next();
}

// Everything but the build's static files and image optimiser runs through
// the proxy — public/ files too, so an upload or a page can't slip past by a
// path the matcher skips.
export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
