import { NextResponse } from "next/server";
import { apiError, requirePermission } from "@/lib/authz";
import { getHomeEditorState, saveHomeDraft } from "@/lib/home-page/service";

// ROUND3 W-7 — the home page manager's draft (website.home). The layout is
// checked with the shared schema (lib/home-page/layout.ts) and every photo,
// item and category it names must exist. Saving a draft changes nothing on
// the website — only Publish does.

export async function GET() {
  try {
    await requirePermission("website.home");
    return NextResponse.json(await getHomeEditorState());
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requirePermission("website.home");
    const body = (await req.json().catch(() => null)) as { layout?: unknown } | null;
    return NextResponse.json(await saveHomeDraft(body?.layout, session.user.id));
  } catch (e) {
    return apiError(e);
  }
}
