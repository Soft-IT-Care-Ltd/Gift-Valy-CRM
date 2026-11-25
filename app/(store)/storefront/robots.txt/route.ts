import { storefrontOrigin } from "@/lib/storefront/hosts";

// ROUND3 W-8 — search engines may read the shop, not the bag, the checkout,
// anyone's order, search results or the staff preview. Staging
// (STOREFRONT_NOINDEX) and "Website off" (lib/storefront/coming-soon.ts)
// disallow everything. The ERP host has no robots.txt of its own: every ERP
// answer carries X-Robots-Tag: noindex (lib/storefront/front-door.ts).
export const dynamic = "force-dynamic";

export function GET() {
  const noindex = /^(1|true|yes)$/i.test(process.env.STOREFRONT_NOINDEX ?? "");
  const body = noindex
    ? "User-agent: *\nDisallow: /\n"
    : [
        "User-agent: *",
        "Allow: /",
        "Disallow: /bag",
        "Disallow: /checkout",
        "Disallow: /order/",
        "Disallow: /api/",
        "Disallow: /search",
        "Disallow: /preview/",
        "",
        `Sitemap: ${storefrontOrigin()}/sitemap.xml`,
        "",
      ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
