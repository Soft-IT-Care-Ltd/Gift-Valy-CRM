import { NextResponse } from "next/server";
import { billingLockGate } from "@/lib/platform/gate";
import { getPlatformState } from "@/lib/platform/state";
import type { PlatformStateName } from "@/lib/platform/state-shape";
import { isStorefrontHost, isStorefrontInternalPath, storefrontRoute } from "./hosts";

// ROUND3 W-1 — what proxy.ts does with every request, kept here so the tests
// can drive it without Next's runtime.
//
// Website host: every path is rewritten into the internal storefront section,
// so an ERP address there (/login, /api/orders, /uploads/…, /api/cron/…,
// /billing) is just a page the storefront doesn't have — a plain 404, never a
// login redirect that would show the ERP exists. Nothing here (or anywhere
// under app/(store) or lib/storefront) reads the staff session. The billing
// lock never applies: customers can still order while Funnel Liner has the
// ERP suspended; their orders wait as drafts (FUNNEL_LINER GV-7).
//
// ERP host: the storefront section doesn't exist (404); everything else goes
// through the billing lock exactly as before. /go/ and /_c/ are Funnel
// Liner's (rule 7): never rewritten or redirected here.

export type ReadState = () => Promise<{ state: PlatformStateName }>;

const notFound = () =>
  new NextResponse("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

/** The website is never framed or sniffed, sends no full referrer elsewhere; staging is never indexed. */
function withStorefrontHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (/^(1|true|yes)$/i.test(process.env.STOREFRONT_NOINDEX ?? "")) {
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return res;
}

export async function frontDoor(
  req: { method: string; nextUrl: URL; headers: Headers },
  readState: ReadState = getPlatformState,
  storefrontHostsEnv: string | undefined = process.env.STOREFRONT_HOSTS
): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  if (isStorefrontHost(req.headers.get("host"), storefrontHostsEnv)) {
    const route = storefrontRoute(pathname);
    if (!route) return withStorefrontHeaders(notFound());
    if ("pass" in route) return withStorefrontHeaders(NextResponse.next());
    const url = new URL(req.nextUrl.toString());
    url.pathname = route.rewrite;
    return withStorefrontHeaders(NextResponse.rewrite(url));
  }

  if (isStorefrontInternalPath(pathname)) return notFound();
  const locked = await billingLockGate(req.method, req.nextUrl, readState);
  return locked ?? NextResponse.next();
}
