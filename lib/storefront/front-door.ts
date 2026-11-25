import { NextResponse } from "next/server";
import { billingLockGate } from "@/lib/platform/gate";
import { getPlatformState } from "@/lib/platform/state";
import type { PlatformStateName } from "@/lib/platform/state-shape";
import { getWebsiteStatus } from "@/lib/website-status";
import { comingSoonResponse, type WebsiteStatus } from "./coming-soon";
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
// ROUND3 W-7: with Settings → Website → "Website on" switched off, every
// website address (but a customer's private order link and its photos) is the
// holding page instead (./coming-soon.ts).
//
// ERP host: the storefront section doesn't exist (404); everything else goes
// through the billing lock exactly as before, and nothing there is indexed
// (W-8: X-Robots-Tag noindex on every answer). /go/ and /_c/ are Funnel
// Liner's (rule 7): never rewritten or redirected here.

export type ReadState = () => Promise<{ state: PlatformStateName }>;
export type ReadWebsiteStatus = () => Promise<WebsiteStatus>;

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

/** The ERP is never in a search engine (W-8). */
function withErpHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

/**
 * Verify R3 — next.config.ts sets skipTrailingSlashRedirect, because Next's
 * own "/x/ → /x" 308 ran BEFORE this proxy: /go/ and /_c/ on the website host
 * answered a redirect instead of rule 7's plain 404. The proxy refuses what it
 * refuses first, then gives every other path the same 308 Next gave (same
 * origin, query kept — Next sends a same-origin Location as a relative one;
 * a proxy redirect must be built from an absolute URL), so nothing else
 * changes on either host.
 */
function trailingSlashRedirect(nextUrl: URL): NextResponse | null {
  const { pathname } = nextUrl;
  if (pathname.length <= 1 || !pathname.endsWith("/")) return null;
  const to = new URL(nextUrl.toString());
  to.pathname = pathname.replace(/\/+$/, "") || "/";
  return NextResponse.redirect(to, 308);
}

export async function frontDoor(
  req: { method: string; nextUrl: URL; headers: Headers },
  readState: ReadState = getPlatformState,
  storefrontHostsEnv: string | undefined = process.env.STOREFRONT_HOSTS,
  readWebsiteStatus: ReadWebsiteStatus = getWebsiteStatus
): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  if (isStorefrontHost(req.headers.get("host"), storefrontHostsEnv)) {
    const route = storefrontRoute(pathname);
    if (!route) return withStorefrontHeaders(notFound());
    const slash = trailingSlashRedirect(req.nextUrl);
    if (slash) return withStorefrontHeaders(slash);
    if ("pass" in route) return withStorefrontHeaders(NextResponse.next());
    const closed = comingSoonResponse(pathname, await readWebsiteStatus());
    if (closed) return withStorefrontHeaders(closed);
    const url = new URL(req.nextUrl.toString());
    url.pathname = route.rewrite;
    return withStorefrontHeaders(NextResponse.rewrite(url));
  }

  if (isStorefrontInternalPath(pathname)) return withErpHeaders(notFound());
  const slash = trailingSlashRedirect(req.nextUrl);
  if (slash) return withErpHeaders(slash);
  const locked = await billingLockGate(req.method, req.nextUrl, readState);
  return withErpHeaders(locked ?? NextResponse.next());
}
