import { NextResponse } from "next/server";
import { apiError, requirePermission } from "@/lib/authz";
import { loadMetaSettingsView, updateMetaSettings } from "@/lib/meta/settings";
import { revalidateStorefrontSettings } from "@/lib/storefront/revalidate";

// ROUND3 W-8 — Settings → Website → Meta Pixel (Admin: settings.manage). The
// token goes in once and never comes back out (masked view only); the audit
// row records only that it changed. The website's pages carry the Pixel ID,
// so a save clears their cache — the next page load has (or drops) the pixel.

export async function GET() {
  try {
    await requirePermission("settings.manage");
    return NextResponse.json(await loadMetaSettingsView());
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requirePermission("settings.manage");
    const view = await updateMetaSettings(await req.json().catch(() => null), session.user.id);
    revalidateStorefrontSettings();
    return NextResponse.json(view);
  } catch (e) {
    return apiError(e);
  }
}
