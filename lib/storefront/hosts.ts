// ROUND3 W-1 — one app, two front doors. The public website answers on Gift
// Valy's own domain (giftvaly.com, www.giftvaly.com; staging
// shop-staging.giftvaly.com), the ERP on dashboard.funnelliner.com (machines
// at /_c/giftvaly/…, which Nginx strips before the request gets here).
//
// Which host is the website comes ONLY from STOREFRONT_HOSTS (comma-separated,
// port and case ignored) — CLAUDE.md rule 9, never a hardcoded name. Every
// other host is the ERP, so the ERP host needs no entry. Unset or empty = no
// website host at all (the app is the ERP only). On a developer's machine set
// STOREFRONT_HOSTS=shop.localhost: http://shop.localhost:3000 is the website
// and http://localhost:3000 the ERP.
//
// Pure and Edge-safe: imported by proxy.ts and by the tests.

/** Every storefront page and public endpoint lives under this internal prefix; the proxy rewrites the website host's paths into it. */
export const STOREFRONT_PREFIX = "/storefront";

/** The website's own static files (logo, share image) in public/shop/, served as they are. */
export const STOREFRONT_STATIC_PREFIX = "/shop/";

/** Host header → bare lower-case host name ("Shop.Localhost:3000" → "shop.localhost"). */
export function hostOnly(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

/** The website's host names, from STOREFRONT_HOSTS. */
export function storefrontHosts(env: string | undefined = process.env.STOREFRONT_HOSTS): string[] {
  return (env ?? "")
    .split(",")
    .map(hostOnly)
    .filter(Boolean);
}

export function isStorefrontHost(
  host: string | null | undefined,
  env: string | undefined = process.env.STOREFRONT_HOSTS
): boolean {
  if (!host) return false;
  const name = hostOnly(host);
  return name !== "" && storefrontHosts(env).includes(name);
}

/** The website's own origin for links, the sitemap and Open Graph tags (STOREFRONT_URL, else the first host). */
export function storefrontOrigin(): string {
  const configured = process.env.STOREFRONT_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const first = storefrontHosts()[0];
  return first ? `https://${first}` : "http://shop.localhost:3000";
}

/** Addresses that belong to the Funnel Liner proxy (CLAUDE.md rule 7) — never answered by the website. */
export const FUNNEL_LINER_PATH = /^\/(go|_c|%5[fF]c)(\/|$)/;

/**
 * Website host: the public path → what to do with it.
 *   { pass }    — serve unchanged (the build's own files, the website's public/shop/ files);
 *   { rewrite } — the internal storefront path;
 *   null        — a plain 404 (Funnel Liner's /go/ + /_c/, and anything already
 *                 under the internal prefix: the public host never names it).
 */
export function storefrontRoute(pathname: string): { pass: true } | { rewrite: string } | null {
  if (pathname === STOREFRONT_PREFIX || pathname.startsWith(`${STOREFRONT_PREFIX}/`)) return null;
  if (FUNNEL_LINER_PATH.test(pathname)) return null;
  if (pathname.startsWith("/_next/") || pathname.startsWith("/__nextjs")) return { pass: true };
  if (pathname.startsWith(STOREFRONT_STATIC_PREFIX)) return { pass: true };
  return { rewrite: pathname === "/" ? STOREFRONT_PREFIX : `${STOREFRONT_PREFIX}${pathname}` };
}

/** ERP host: the storefront section does not exist there. */
export function isStorefrontInternalPath(pathname: string): boolean {
  return pathname === STOREFRONT_PREFIX || pathname.startsWith(`${STOREFRONT_PREFIX}/`);
}
