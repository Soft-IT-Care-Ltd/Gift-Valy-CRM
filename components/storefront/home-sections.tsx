import Link from "next/link";
import { ArrowRight, Camera } from "lucide-react";
import { BannerSlider } from "@/components/storefront/banner-slider";
import { CategoryTiles } from "@/components/storefront/category-tiles";
import { ProductGrid } from "@/components/storefront/product-card";
import { RichText } from "@/components/storefront/rich-text";
import { WebPhoto } from "@/components/storefront/web-photo";
import { copy } from "@/lib/storefront/copy";
import { formatTaka } from "@/lib/storefront/format";
import type { HomeBlock, HomeView } from "@/lib/storefront/home-types";

// ROUND3 W-7 — the home page's sections, in the order the home page manager
// published them (or the draft, on the signed preview): the banner slider,
// category tiles, featured gifts, the Customize Chocolate Box highlight, text
// blocks, all gifts, the promises. A section with nothing to show was already
// left out (lib/storefront/home-data.ts).

function LinkButton({ link, label }: { link: string; label: string }) {
  const external = link.startsWith("https://");
  return (
    <a href={link} className="sf-btn sf-btn-navy self-start" {...(external ? { target: "_blank", rel: "noopener" } : {})}>
      {label} <ArrowRight className="size-5" />
    </a>
  );
}

function Block({ block, whatsapp, builtAt, priority }: { block: HomeBlock; whatsapp: string; builtAt: string; priority: number }) {
  const h = `h-${block.key}`;
  switch (block.kind) {
    case "banners":
      return <BannerSlider items={block.items} builtAt={builtAt} whatsapp={whatsapp} />;
    case "categories":
      return (
        <section className="sf-container pt-8" aria-labelledby={h}>
          <h2 id={h} className="mb-4 text-2xl md:text-3xl">
            {block.title || copy.home.categories}
          </h2>
          <CategoryTiles categories={block.categories} />
        </section>
      );
    case "items":
      return (
        <section className="sf-container pt-10" aria-labelledby={h}>
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 id={h} className="text-2xl md:text-3xl">
              {block.title || copy.home.featured}
            </h2>
            {block.moreHref ? (
              <Link href={block.moreHref} className="inline-flex min-h-12 items-center gap-1 font-semibold text-navy hover:underline">
                {copy.home.seeAll} <ArrowRight className="size-4" />
              </Link>
            ) : null}
          </div>
          <ProductGrid items={block.items} priorityFirst={priority} />
        </section>
      );
    case "photo_box": {
      const item = block.item;
      return (
        <section className="sf-container pt-10" aria-labelledby={h}>
          <Link
            href={`/p/${item.slug}`}
            className="group grid overflow-hidden rounded-card bg-navy text-white shadow-[var(--shadow-card)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
          >
            <div className="sf-photo">
              <WebPhoto image={item.image} name={item.name} sizes="(min-width: 768px) 520px, 100vw" />
            </div>
            <div className="flex flex-col justify-center gap-3 p-5 md:p-10">
              <p className="flex items-center gap-2 text-sm font-semibold tracking-[0.12em] text-orange-200 uppercase">
                <Camera className="size-4" /> {copy.home.customize.kicker}
              </p>
              <h2 id={h} className="text-[28px] text-white md:text-4xl">
                {item.name}
              </h2>
              {item.printPhotos > 0 ? <p className="text-[16px] text-white/85">{copy.home.customize.body(item.printPhotos)}</p> : null}
              <p className="font-display text-2xl font-bold text-orange-200">{formatTaka(item.price)}</p>
              <span className="sf-btn sf-btn-orange self-start">
                {copy.home.customize.cta} <ArrowRight className="size-5" />
              </span>
            </div>
          </Link>
        </section>
      );
    }
    case "text":
      return (
        <section className="sf-container pt-10" aria-labelledby={block.title ? h : undefined}>
          <div className="flex flex-col gap-3 rounded-card border border-line bg-white p-5 md:p-8">
            {block.title ? (
              <h2 id={h} className="text-2xl md:text-3xl">
                {block.title}
              </h2>
            ) : null}
            <RichText blocks={block.body} className="max-w-3xl text-[16px] leading-relaxed text-body" />
            {block.button ? <LinkButton link={block.button.link} label={block.button.label} /> : null}
          </div>
        </section>
      );
    case "all":
      return (
        <section className="sf-container scroll-mt-28 pt-10" id="all" aria-labelledby={h}>
          <h2 id={h} className="mb-4 text-2xl md:text-3xl">
            {block.title || copy.home.all}
          </h2>
          <ProductGrid items={block.items} priorityFirst={priority} />
          <div className="mt-6 flex justify-center">
            <Link href="/search" className="sf-btn sf-btn-outline">
              {copy.search.heading}
            </Link>
          </div>
        </section>
      );
    case "promises":
      return (
        <section className="sf-container pt-12" aria-label={copy.banners.promisesLabel}>
          <ul className="grid gap-2 rounded-card border border-line bg-white p-4 text-center text-[15px] font-medium text-navy sm:grid-cols-3">
            {copy.home.promises.map((p) => (
              <li key={p} className="py-1">
                {p}
              </li>
            ))}
          </ul>
        </section>
      );
  }
}

export function HomeSections({ view, whatsapp, title }: { view: HomeView; whatsapp: string; title: string }) {
  const hasGifts = view.blocks.some((b) => b.kind === "items" || b.kind === "all" || b.kind === "photo_box");
  // The first grid on the page loads its first photos eagerly (only when no banner photo is above it).
  const firstGrid = view.blocks.findIndex((b) => b.kind === "items" || b.kind === "all");
  const bannerAbove = view.blocks.findIndex((b) => b.kind === "banners");
  return (
    <>
      <h1 className="sf-visually-hidden">{title}</h1>
      {view.blocks.map((b, i) => (
        <Block key={b.key} block={b} whatsapp={whatsapp} builtAt={view.builtAt} priority={i === firstGrid && (bannerAbove < 0 || bannerAbove > i) ? 2 : 0} />
      ))}
      {!hasGifts ? <p className="sf-container py-16 text-center text-muted">{copy.home.empty}</p> : null}
    </>
  );
}
