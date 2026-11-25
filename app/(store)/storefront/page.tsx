import Link from "next/link";
import { ArrowRight, Camera } from "lucide-react";
import { CategoryTiles } from "@/components/storefront/category-tiles";
import { ProductGrid } from "@/components/storefront/product-card";
import { WebPhoto } from "@/components/storefront/web-photo";
import { cachedHome, cachedSettings } from "@/lib/storefront/cached";
import { whatsappLink } from "@/lib/storefront/chat";
import { copy } from "@/lib/storefront/copy";
import { formatTaka } from "@/lib/storefront/format";

// ROUND3 W-4 — the home page. Until the home page manager (W-7) exists the
// sections are fixed: the brand banner, category tiles, featured gifts, the
// "Customize Chocolate Box" highlight (the first shown item whose print kit
// asks for photos), all gifts, and the promises. Cached; cleared with the
// catalog, the settings and the home page (lib/storefront/revalidate.ts).
export const revalidate = 600;

export default async function StoreHome() {
  const [home, settings] = await Promise.all([cachedHome(), cachedSettings()]);
  const empty = home.all.length === 0;

  return (
    <>
      <section className="bg-gradient-to-br from-orange-50 via-cream to-navy-50">
        <div className="sf-container grid items-center gap-6 py-8 md:grid-cols-[1.3fr_1fr] md:py-14">
          <div className="flex flex-col gap-4">
            <h1 className="text-[34px] leading-[1.1] md:text-[56px]">{copy.home.heroTitle}</h1>
            <p className="max-w-xl text-[17px] text-body md:text-lg">{copy.home.heroBody}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href="#all" className="sf-btn sf-btn-navy">
                {copy.home.heroCta} <ArrowRight className="size-5" />
              </Link>
              {settings.whatsapp ? (
                <a href={whatsappLink(settings.whatsapp, "")} target="_blank" rel="noopener" className="sf-btn sf-btn-whatsapp">
                  {copy.home.heroChat}
                </a>
              ) : null}
            </div>
          </div>
          <div className="hidden justify-center md:flex">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/shop/icon.png" alt="" width={320} height={320} className="size-72 rounded-[28%] mix-blend-multiply" />
          </div>
        </div>
      </section>

      {empty ? <p className="sf-container py-16 text-center text-muted">{copy.home.empty}</p> : null}

      {home.categories.length > 0 ? (
        <section className="sf-container pt-8" aria-labelledby="h-categories">
          <h2 id="h-categories" className="mb-4 text-2xl md:text-3xl">
            {copy.home.categories}
          </h2>
          <CategoryTiles categories={home.categories} />
        </section>
      ) : null}

      {home.featured.length > 0 ? (
        <section className="sf-container pt-10" aria-labelledby="h-featured">
          <h2 id="h-featured" className="mb-4 text-2xl md:text-3xl">
            {copy.home.featured}
          </h2>
          <ProductGrid items={home.featured} priorityFirst={2} />
        </section>
      ) : null}

      {home.customize ? (
        <section className="sf-container pt-10" aria-labelledby="h-customize">
          <Link
            href={`/p/${home.customize.slug}`}
            className="group grid overflow-hidden rounded-card bg-navy text-white shadow-[var(--shadow-card)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
          >
            <div className="sf-photo">
              <WebPhoto image={home.customize.image} name={home.customize.name} sizes="(min-width: 768px) 520px, 100vw" />
            </div>
            <div className="flex flex-col justify-center gap-3 p-5 md:p-10">
              <p className="flex items-center gap-2 text-sm font-semibold tracking-[0.12em] text-orange-200 uppercase">
                <Camera className="size-4" /> {copy.home.customize.kicker}
              </p>
              <h2 id="h-customize" className="text-[28px] text-white md:text-4xl">
                {home.customize.name}
              </h2>
              <p className="text-[16px] text-white/85">{copy.home.customize.body(home.customize.printPhotos)}</p>
              <p className="font-display text-2xl font-bold text-orange-200">{formatTaka(home.customize.price)}</p>
              <span className="sf-btn sf-btn-orange self-start">
                {copy.home.customize.cta} <ArrowRight className="size-5" />
              </span>
            </div>
          </Link>
        </section>
      ) : null}

      {!empty ? (
        <section className="sf-container scroll-mt-28 pt-10" id="all" aria-labelledby="h-all">
          <h2 id="h-all" className="mb-4 text-2xl md:text-3xl">
            {copy.home.all}
          </h2>
          <ProductGrid items={home.all} priorityFirst={home.featured.length > 0 ? 0 : 2} />
          <div className="mt-6 flex justify-center">
            <Link href="/search" className="sf-btn sf-btn-outline">
              {copy.search.heading}
            </Link>
          </div>
        </section>
      ) : null}

      <section className="sf-container pt-12">
        <ul className="grid gap-2 rounded-card border border-line bg-white p-4 text-center text-[15px] font-medium text-navy sm:grid-cols-3">
          {copy.home.promises.map((p) => (
            <li key={p} className="py-1">
              {p}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
