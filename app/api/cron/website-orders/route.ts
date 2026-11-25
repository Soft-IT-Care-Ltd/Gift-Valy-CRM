import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { timingSafeEqual } from "@/lib/crypto";
import { dealUnassignedWebsiteOrders } from "@/lib/website-assignment";

// ROUND3 W-6 — every 15 minutes: give out website orders that arrived when no
// Sales Executive was active (held by "Website (system)"), by the same rules
// as a new order (lib/website-assignment.ts). Safe to run twice. Machine-to-
// machine: "Authorization: Bearer <CRON_SECRET>". Locked with the rest of the
// ERP while Funnel Liner has it suspended (lib/platform/lock.ts) — the orders
// simply wait, as drafts.
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
    const dealt = await dealUnassignedWebsiteOrders(prisma);
    return NextResponse.json({ ok: true, dealt });
  } catch (e) {
    console.error("website-orders job failed:", e);
    return NextResponse.json({ ok: false, error: "Website-orders job failed" }, { status: 500 });
  }
}
