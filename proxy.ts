import type { NextRequest } from "next/server";
import { frontDoor } from "@/lib/storefront/front-door";

// ROUND3 W-1 — one app, two front doors (lib/storefront/front-door.ts): the
// website host (STOREFRONT_HOSTS) is rewritten into the internal storefront
// section and never locked; on the ERP host the storefront doesn't exist.
//
// FUNNEL_LINER.md GV-7 — the billing lock is enforced here and nowhere else.
// Every ERP-host request passes this point before any page or route runs
// (Next 16's proxy, Node.js runtime). While Funnel Liner has the ERP
// "suspended", every page goes to /billing and every API route answers 423,
// except what lib/platform/lock.ts lists as open, with its reason. Machine
// routes (/api/platform/*, /api/cron/*, /api/webhooks/*) carry no session and
// need none here: each checks its own secret, as before.
export default async function proxy(req: NextRequest) {
  return frontDoor(req);
}

// Everything but the build's static files and image optimiser runs through
// the proxy — public/ files too, so an upload or a page can't slip past by a
// path the matcher skips, and the website host can't reach an ERP file.
export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
