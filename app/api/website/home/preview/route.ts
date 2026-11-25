import { NextResponse } from "next/server";
import { apiError, requirePermission } from "@/lib/authz";
import { makePreviewToken } from "@/lib/home-page/preview-token";
import { storefrontOrigin } from "@/lib/storefront/hosts";

// ROUND3 W-7 — a signed link to the SAVED draft on the real website, good for
// two hours (lib/home-page/preview-token.ts). The website never reads the
// staff session; this link is its only way in to the draft.
export async function POST() {
  try {
    await requirePermission("website.home");
    return NextResponse.json({ url: `${storefrontOrigin()}/preview/home?t=${encodeURIComponent(makePreviewToken())}` });
  } catch (e) {
    return apiError(e);
  }
}
