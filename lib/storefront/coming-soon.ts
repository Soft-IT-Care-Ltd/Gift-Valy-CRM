import { NextResponse } from "next/server";
import { messengerLink, whatsappLink } from "./chat";
import { copy } from "./copy";

// ROUND3 W-7 — Settings → Website → "Website on" switched off: every address
// on the website host is answered here, before any storefront route runs —
// one holding page (the logo and how to reach the shop), no catalogue, no
// bag, no checkout, no order endpoint, nothing for a search engine to index.
// Two things stay open: a customer's private order link (/order/<token>, she
// can still see the order she placed) and the photos it shows (/img/…). The
// ERP host is never affected. Pure (no database): the proxy passes the status
// in (lib/website-status.ts). Edge-safe.

export type WebsiteStatus = {
  on: boolean;
  contact: { whatsapp: string; messengerPage: string; facebookUrl: string; hotline: string };
};

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

/** What stays reachable while the website is off (public paths, before the rewrite). */
export const OPEN_WHILE_OFF = /^\/(order|img)\//;

/** Null = let the request through; otherwise the answer to send instead. */
export function comingSoonResponse(pathname: string, status: WebsiteStatus): NextResponse | null {
  if (status.on || OPEN_WHILE_OFF.test(pathname)) return null;
  if (pathname === "/robots.txt") {
    return new NextResponse("User-agent: *\nDisallow: /\n", { headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: copy.comingSoon.api }, { status: 503, headers: { ...HEADERS, "Retry-After": "3600" } });
  }
  return new NextResponse(comingSoonHtml(status.contact), {
    status: 503,
    headers: { ...HEADERS, "Retry-After": "3600", "Content-Type": "text/html; charset=utf-8" },
  });
}

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The holding page: self-contained (no bundle, no font download), in the brand colours. */
export function comingSoonHtml(contact: WebsiteStatus["contact"]): string {
  const links: string[] = [];
  if (contact.whatsapp) links.push(`<a href="${esc(whatsappLink(contact.whatsapp, ""))}" rel="noopener">WhatsApp</a>`);
  if (contact.messengerPage) links.push(`<a href="${esc(messengerLink(contact.messengerPage))}" rel="noopener">Messenger</a>`);
  if (contact.facebookUrl) links.push(`<a href="${esc(contact.facebookUrl)}" rel="noopener">Facebook</a>`);
  if (contact.hotline) links.push(`<a href="tel:${esc(contact.hotline.replace(/[^\d+]/g, ""))}">${esc(contact.hotline)}</a>`);
  const contactBlock = links.length ? `<p class="lead">${esc(copy.comingSoon.contact)}</p><nav>${links.join("")}</nav>` : "";
  return `<!doctype html>
<html lang="${copy.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#2c347c">
<title>${esc(copy.comingSoon.title)}</title>
<link rel="icon" href="/shop/icon.png" type="image/png">
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:#FFFAF4;color:#1d2152;font-family:"Hind Siliguri","Noto Sans Bengali",system-ui,sans-serif;padding:24px 16px;text-align:center}
main{max-width:28rem;width:100%}
img{width:120px;height:120px;border-radius:28%}
h1{font-size:1.9rem;margin:18px 0 6px;color:#2c347c}
.tag{color:#b5650f;margin:0 0 18px;letter-spacing:.08em;text-transform:uppercase;font-size:.8rem;font-weight:600}
p{line-height:1.7;margin:0 0 12px;color:#3b3f63}
.lead{margin-top:24px}
nav{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
nav a{color:#2c347c;text-decoration:none;border:1.5px solid #2c347c;border-radius:999px;padding:10px 20px;min-height:48px;display:inline-flex;align-items:center;font-weight:600}
nav a:hover{background:#2c347c;color:#fff}
</style>
</head>
<body>
<main>
<img src="/shop/icon.png" alt="${esc(copy.brand.name)}" width="120" height="120">
<h1>${esc(copy.brand.name)}</h1>
<p class="tag">${esc(copy.comingSoon.tag)}</p>
<p>${esc(copy.comingSoon.body)}</p>
${contactBlock}
</main>
</body>
</html>`;
}
