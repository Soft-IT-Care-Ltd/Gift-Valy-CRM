import { NextResponse } from "next/server";
import { apiError, requirePermission } from "@/lib/authz";
import { discardHomeDraft } from "@/lib/home-page/service";

// ROUND3 W-7 — throw the draft away: back to what the website shows. Nothing
// on the website changes.
export async function POST() {
  try {
    const session = await requirePermission("website.home");
    return NextResponse.json(await discardHomeDraft(session.user.id));
  } catch (e) {
    return apiError(e);
  }
}
