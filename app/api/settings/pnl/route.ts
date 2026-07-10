import { NextResponse } from "next/server";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getPnlSettings, savePnlSettings } from "@/lib/pnl";

// SPEC §9.2 — packaging cost per order + ad-cost allocation method. Admin-only
// (settings.manage), same gate as the other /settings pages.
export async function GET() {
  try {
    await requirePermission("settings.manage");
    return NextResponse.json(await getPnlSettings());
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requirePermission("settings.manage");
    const before = await getPnlSettings();
    const settings = await savePnlSettings(await req.json());
    await logAudit({
      userId: session.user.id,
      action: "settings.update",
      entity: "settings",
      entityId: "pnl_settings",
      before,
      after: settings,
    });
    return NextResponse.json(settings);
  } catch (e) {
    return apiError(e);
  }
}
