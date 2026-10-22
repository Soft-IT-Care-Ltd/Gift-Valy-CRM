// FUNNEL_LINER.md GV-7 — what stays open while Funnel Liner has Gift Valy
// "suspended". Pure (no database, no next-auth) so the proxy, the docs and the
// test share it. Closed by default: this file lists what stays OPEN, with the
// reason for each; every other page and API route is locked, so a page or
// route added later is covered the day it is added. tests/billing-lock.test.ts
// walks every page, route and public file and fails when the open set changes
// without this list (and that test) changing with it.

export type OpenRule = { path: RegExp; why: string };

/** Pages a signed-in person can still open. Every other page → /billing. */
const OPEN_PAGES: OpenRule[] = [
  { path: /^\/billing(\/.*)?$/, why: "the bill and its print-ready invoices (the short message for roles without billing.view)" },
  { path: /^\/login$/, why: "sign in" },
  { path: /^\/change-password$/, why: "change own password (also the forced change after a reset)" },
];

/** API routes that still answer. Every other one → 423. */
const OPEN_API: OpenRule[] = [
  { path: /^\/api\/auth\/.+$/, why: "sign in and sign out (NextAuth: signin, signout, session, csrf, callback)" },
  { path: /^\/api\/account\/change-password$/, why: "change own password" },
  { path: /^\/api\/platform\/.+$/, why: "Funnel Liner: lifting the suspension, billing push, usage, has-user (part of signing in)" },
  { path: /^\/api\/webhooks\/steadfast$/, why: "Steadfast status of parcels already with the courier" },
  { path: /^\/api\/cron\/steadfast-sync$/, why: "Steadfast status + payments sync — parcels keep moving, money keeps reconciling" },
];

/** Files and build output the open pages need. Uploads (photos, payment screenshots) are business data: closed. */
const OPEN_ASSETS: OpenRule[] = [
  { path: /^\/_next\/.+$/, why: "the build's own scripts, styles and images" },
  { path: /^\/sw\.js$/, why: "PWA service worker" },
  { path: /^\/manifest\.webmanifest$/, why: "PWA manifest" },
  { path: /^\/offline\.html$/, why: "PWA offline page" },
  { path: /^\/icons\/[^/]+$/, why: "PWA icons" },
  { path: /^\/favicon\.ico$/, why: "browser tab icon" },
  { path: /^\/fonts\/[^/]+$/, why: "Bangla font for the open pages" },
  { path: /^\/gift-valy-logo\.png$/, why: "logo on the sign-in and Billing pages" },
];

export const BILLING_LOCK_OPEN = { pages: OPEN_PAGES, api: OPEN_API, assets: OPEN_ASSETS };

export type LockVerdict = "open" | "redirect" | "refuse";

const READS = new Set(["GET", "HEAD"]);

/**
 * What the proxy does with this request while suspended: let it through,
 * send the page to /billing, or refuse it with 423. Nothing here depends on
 * the state — the gate only asks for the state when this isn't "open".
 */
export function lockVerdict(method: string, pathname: string): LockVerdict {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const isApi = path === "/api" || path.startsWith("/api/");
  if (isApi) return OPEN_API.some((r) => r.path.test(path)) ? "open" : "refuse";
  if (OPEN_ASSETS.some((r) => r.path.test(path))) return "open";
  if (OPEN_PAGES.some((r) => r.path.test(path))) return "open";
  // A page. Only a plain read is redirected; anything else has no business
  // with a page address (the app has no Server Actions) and is refused.
  return READS.has(method.toUpperCase()) ? "redirect" : "refuse";
}

/** True when the request never needs the platform state (open whatever it is). */
export function alwaysOpen(method: string, pathname: string): boolean {
  return lockVerdict(method, pathname) === "open";
}

// Every message a locked-out person sees is in English and Bangla.
export const LOCK_MESSAGE_EN =
  "The dashboard is closed because the Funnel Liner bill is unpaid. Your shop's admin has the details.";
export const LOCK_MESSAGE_BN =
  "Funnel Liner এর বিল পরিশোধ না হওয়ায় ড্যাশবোর্ড বন্ধ আছে। বিস্তারিত আপনার শপের অ্যাডমিন জানেন।";
export const LOCK_ERROR = `${LOCK_MESSAGE_EN} ${LOCK_MESSAGE_BN}`;
export const LOCK_CODE = "BILLING_LOCKED";
