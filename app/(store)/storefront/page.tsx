import type { Metadata } from "next";
import { HomeSections } from "@/components/storefront/home-sections";
import { cachedHome, cachedSettings } from "@/lib/storefront/cached";
import { copy } from "@/lib/storefront/copy";
import { SHARE_IMAGE } from "@/lib/storefront/seo";

// ROUND3 W-4 / W-7 — the home page: the sections the home page manager
// published (Catalog → Website Home Page) — banners, featured categories,
// featured gifts, the Customize Chocolate Box highlight, text blocks, all
// gifts, the promises; the starting layout until the first publish. Cached;
// cleared when the home page is published, the catalog changes, or Settings
// → Website is saved (lib/storefront/revalidate.ts).
export const revalidate = 600;

export async function generateMetadata(): Promise<Metadata> {
  const s = await cachedSettings();
  const title = s.homeSeo.title || copy.meta.homeTitle;
  const description = s.homeSeo.description || copy.brand.tagline;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: "/" },
    openGraph: { title, description, url: "/", images: [{ ...SHARE_IMAGE, alt: title }] },
  };
}

export default async function StoreHome() {
  const [view, settings] = await Promise.all([cachedHome(), cachedSettings()]);
  return <HomeSections view={view} whatsapp={settings.whatsapp} title={settings.homeSeo.title || copy.meta.homeTitle} />;
}
