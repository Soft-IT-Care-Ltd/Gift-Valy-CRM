import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { apiError, requirePermission } from "@/lib/authz";
import { settingsErrors } from "@/lib/storefront/settings-form";
import { revalidateStorefrontSettings } from "@/lib/storefront/revalidate";
import { readWebsiteSettingsForm, saveWebsiteSettings } from "@/lib/website-settings";
import { forgetWebsiteStatus } from "@/lib/website-status";

// ROUND3 W-7 — Settings → Website (Admin: settings.manage). PUT checks the
// whole form with the shared schema, stores it, audits it (settings.website,
// before/after), then clears the website's cache and the proxy's Website
// on/off flag — the very next page load shows the change.

export async function GET() {
  try {
    await requirePermission("settings.manage");
    return NextResponse.json(await readWebsiteSettingsForm());
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requirePermission("settings.manage");
    const saved = await saveWebsiteSettings(await req.json().catch(() => null), session.user.id);
    revalidateStorefrontSettings();
    forgetWebsiteStatus();
    return NextResponse.json(saved);
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Please fix the marked fields", fields: settingsErrors(e) }, { status: 400 });
    }
    return apiError(e);
  }
}
