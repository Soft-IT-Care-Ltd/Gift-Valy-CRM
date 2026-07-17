import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { SETTING_KEYS, getOccasionReminderLeadDays } from "@/lib/settings";

// CORRECTIONS Orders §7 (C8) — the configurable occasion reminder lead time
// (days before the date). Admin-only (settings.manage), like the other
// /settings pages.
export async function GET() {
  try {
    await requirePermission("settings.manage");
    return NextResponse.json({ leadDays: await getOccasionReminderLeadDays() });
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requirePermission("settings.manage");
    const before = await getOccasionReminderLeadDays();
    const body = await req.json();
    const leadDays = Math.max(0, Math.min(365, Math.round(Number(body.leadDays))));
    if (!Number.isFinite(leadDays)) {
      return NextResponse.json({ error: "Invalid lead time" }, { status: 400 });
    }

    await prisma.setting.upsert({
      where: { key: SETTING_KEYS.occasionReminderLeadDays },
      create: { key: SETTING_KEYS.occasionReminderLeadDays, value: leadDays },
      update: { value: leadDays },
    });

    await logAudit({
      userId: session.user.id,
      action: "settings.update",
      entity: "settings",
      entityId: SETTING_KEYS.occasionReminderLeadDays,
      before: { leadDays: before },
      after: { leadDays },
    });

    return NextResponse.json({ leadDays });
  } catch (e) {
    return apiError(e);
  }
}
