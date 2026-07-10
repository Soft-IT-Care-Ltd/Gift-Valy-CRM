import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { SETTING_KEYS, getOnboardingExcludeDays } from "@/lib/settings";

// SPEC §10 — the onboarding grace window: how many days a new joiner flagged
// `is_onboarding` is left out of team aggregate targets. Managed with the rest
// of the Targets & Rewards admin (targets.manage).
export async function GET() {
  try {
    await requirePermission("targets.manage");
    const onboardingExcludeDays = await getOnboardingExcludeDays();
    return NextResponse.json({ onboardingExcludeDays });
  } catch (e) {
    return apiError(e);
  }
}

const bodySchema = z.object({
  onboardingExcludeDays: z.number().int().min(0).max(365),
});

export async function PUT(req: Request) {
  try {
    const session = await requirePermission("targets.manage");
    const { onboardingExcludeDays } = bodySchema.parse(await req.json());

    await prisma.setting.upsert({
      where: { key: SETTING_KEYS.onboardingExcludeDays },
      update: { value: onboardingExcludeDays },
      create: {
        key: SETTING_KEYS.onboardingExcludeDays,
        value: onboardingExcludeDays,
      },
    });
    await logAudit({
      userId: session.user.id,
      action: "settings.update",
      entity: "settings",
      entityId: SETTING_KEYS.onboardingExcludeDays,
      after: { onboardingExcludeDays },
    });
    return NextResponse.json({ onboardingExcludeDays });
  } catch (e) {
    return apiError(e);
  }
}
