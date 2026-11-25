import { NextResponse } from "next/server";
import { apiError, requirePermission } from "@/lib/authz";
import { publishHomePage } from "@/lib/home-page/service";
import { revalidateStorefrontHome } from "@/lib/storefront/revalidate";

// ROUND3 W-7 — the saved draft becomes the website's home page (audited
// website.home.publish, before/after). The home page's cache is cleared after
// the commit, so the very next page load shows it.
export async function POST() {
  try {
    const session = await requirePermission("website.home");
    const state = await publishHomePage(session.user.id);
    revalidateStorefrontHome();
    return NextResponse.json(state);
  } catch (e) {
    return apiError(e);
  }
}
