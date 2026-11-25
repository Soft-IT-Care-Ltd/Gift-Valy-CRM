import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { timingSafeEqual } from "@/lib/crypto";
import { flushMetaEvents, purgeMetaEvents, sweepConfirmedPurchases } from "@/lib/meta/send";

// ROUND3 W-8 — every 5 minutes: send the Meta events still waiting (a send
// right after the response failed, or ran out of time) and retry failures
// (1, 5, 15, 60, 180 min, then Failed); give a Purchase to any website order
// confirmed in the last 7 days that has none yet; drop old rows (browsing 30
// days, order events 180, placement captures 30). Nothing is sent while
// tracking is off. Machine-to-machine: "Authorization: Bearer <CRON_SECRET>".
// Locked with the rest of the ERP while Funnel Liner has it suspended — the
// events simply wait (Meta takes them up to 7 days late).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const presented = req.headers.get("authorization");
  if (!secret || !presented || !timingSafeEqual(presented, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const purchases = await sweepConfirmedPurchases(prisma);
    const flushed = await flushMetaEvents(prisma, { limit: 300 });
    const purged = await purgeMetaEvents(prisma);
    return NextResponse.json({ ok: true, purchases, ...flushed, purged });
  } catch (e) {
    console.error("meta-events job failed:", e);
    return NextResponse.json({ ok: false, error: "Meta-events job failed" }, { status: 500 });
  }
}
