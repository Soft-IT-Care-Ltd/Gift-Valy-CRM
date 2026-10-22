import { NextResponse } from "next/server";
import { timingSafeEqual } from "@/lib/crypto";

// FUNNEL_LINER.md GV-2 — machine-to-machine auth for /api/platform/*:
// "Authorization: Bearer <PLATFORM_SECRET>", no session. Its own secret, never
// CRON_SECRET (the scheduler can't read billing or change the state; Funnel
// Liner can't run a cron job). Constant-time compare like app/api/cron/*.
// Fails closed when PLATFORM_SECRET is unset or blank — and when it was set to
// the same value as CRON_SECRET, which would let the scheduler in. Returns the
// 401 to send, or null when the caller is Funnel Liner.
export function rejectUnlessPlatform(req: Request): NextResponse | null {
  const secret = process.env.PLATFORM_SECRET?.trim();
  const cron = process.env.CRON_SECRET?.trim();
  const presented = req.headers.get("authorization") ?? "";
  if (!secret || secret === cron || !timingSafeEqual(presented, `Bearer ${secret}`)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  return null;
}
