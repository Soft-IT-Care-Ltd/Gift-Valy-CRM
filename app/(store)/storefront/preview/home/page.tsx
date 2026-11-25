import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HomeSections } from "@/components/storefront/home-sections";
import { verifyPreviewToken } from "@/lib/home-page/preview-token";
import { cachedSettings } from "@/lib/storefront/cached";
import { getHomeLayout } from "@/lib/storefront/catalog";
import { copy } from "@/lib/storefront/copy";
import { buildHomeView } from "@/lib/storefront/home-data";

// ROUND3 W-7 — the home page manager's DRAFT on the real website, before it
// is published. Reached only by the signed link the ERP hands out
// (lib/home-page/preview-token.ts, two hours); anything else is a 404.
// Never cached, never indexed, sends no Meta event.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.preview.title, robots: { index: false, follow: false } };

export default async function HomePreview({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  if (!verifyPreviewToken((await searchParams).t)) notFound();
  const [view, settings] = await Promise.all([getHomeLayout("draft").then((l) => buildHomeView(l)), cachedSettings()]);
  return (
    <>
      <p className="sticky top-0 z-30 bg-navy px-4 py-2 text-center text-sm font-semibold text-orange-200">{copy.preview.bar}</p>
      <HomeSections view={view} whatsapp={settings.whatsapp} title={copy.preview.title} />
    </>
  );
}
