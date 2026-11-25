import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { sendMetaTestEvent } from "@/lib/meta/send";

// ROUND3 W-8 — "Send test event": one PageView to Meta's Test Events tab (the
// test code is required, so nothing reaches real reporting), sent now, with
// Meta's answer shown. Works before tracking is switched on.
export async function POST(req: Request) {
  try {
    const session = await requirePermission("settings.manage");
    const ip = req.headers.get("x-real-ip") ?? null;
    const result = await sendMetaTestEvent(prisma, { ip, userAgent: req.headers.get("user-agent") });
    await logAudit({ userId: session.user.id, action: "settings.website.meta.test", entity: "meta_tracking", entityId: "meta", after: { ok: result.ok } });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return apiError(e);
  }
}
