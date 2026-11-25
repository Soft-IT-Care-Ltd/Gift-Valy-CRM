import { cachedSettings, cachedSitemap } from "@/lib/storefront/cached";
import { storefrontOrigin } from "@/lib/storefront/hosts";
import { POLICY_KINDS } from "@/lib/storefront/settings-shape";

// ROUND3 W-8 — the website's sitemap: home, every shown category, every
// shown product and package (with when it last changed), and the policies
// that have their text. Only what the website shows — read through the gate.
export const revalidate = 600;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export async function GET() {
  const origin = storefrontOrigin();
  const [{ categories, items }, settings] = await Promise.all([cachedSitemap(), cachedSettings()]);
  const urls = [
    `<url><loc>${esc(`${origin}/`)}</loc></url>`,
    ...categories.map((slug) => `<url><loc>${esc(`${origin}/c/${slug}`)}</loc></url>`),
    ...items.map((i) => `<url><loc>${esc(`${origin}/p/${i.slug}`)}</loc><lastmod>${i.lastmod}</lastmod></url>`),
    ...POLICY_KINDS.filter((k) => settings.policies[k]).map((k) => `<url><loc>${esc(`${origin}/policy/${k}`)}</loc></url>`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
