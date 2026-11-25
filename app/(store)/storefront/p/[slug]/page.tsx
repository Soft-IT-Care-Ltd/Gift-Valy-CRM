import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ChevronRight, Truck } from "lucide-react";
import { ItemPurchase } from "@/components/storefront/item-purchase";
import { MetaViewContent } from "@/components/storefront/meta-pixel";
import { Badge, ProductGrid } from "@/components/storefront/product-card";
import { ProductGallery } from "@/components/storefront/product-gallery";
import { RichText } from "@/components/storefront/rich-text";
import { cachedCurrencies, cachedItem, cachedRelated, cachedSettings } from "@/lib/storefront/cached";
import { copy } from "@/lib/storefront/copy";
import { formatTaka } from "@/lib/storefront/format";
import { storefrontOrigin } from "@/lib/storefront/hosts";
import { jsonLdText, ogPhoto, productJsonLd } from "@/lib/storefront/seo";
import { POLICY_TITLES, type WebSettings } from "@/lib/storefront/settings-shape";
import type { WebDelivery } from "@/lib/storefront/types";

// ROUND3 W-4 — a product or package page, /p/<slug>. Built once and cached;
// rebuilt straight after the item, its price or choices, a photo, the
// website switch or stock changes (lib/storefront/revalidate.ts), else every
// 10 minutes. An old address answers with a permanent redirect.
export const revalidate = 600;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await cachedItem((await params).slug);
  if (!found || !("item" in found)) return { title: copy.meta.notFound, robots: { index: false } };
  const p = found.item;
  const description = p.seoDescription || copy.meta.pageDescription(p.name);
  const image = ogPhoto(p.photos[0]?.path ?? p.image?.path);
  return {
    title: p.seoTitle,
    description,
    alternates: { canonical: `/p/${p.slug}` },
    openGraph: { title: p.seoTitle, description, url: `/p/${p.slug}`, images: [{ ...image, alt: p.name }] },
    twitter: { card: "summary_large_image", title: p.seoTitle, description, images: [image.url] },
  };
}

export default async function ItemPage({ params }: Props) {
  const { slug } = await params;
  const found = await cachedItem(slug);
  if (!found) notFound();
  if ("redirectTo" in found) permanentRedirect(`/p/${found.redirectTo}`);
  const item = found.item;
  const [settings, related] = await Promise.all([cachedSettings(), cachedRelated(item.slug)]);
  const currencies = settings.approxCurrency ? await cachedCurrencies() : null;
  const chat =
    settings.whatsapp || settings.messengerPage
      ? { whatsapp: settings.whatsapp, messengerPage: settings.messengerPage, template: settings.productMessage, link: `${storefrontOrigin()}/p/${item.slug}` }
      : null;
  const mainCategory = item.categories[0] ?? null;

  return (
    <div className="sf-container md:pt-6">
      <nav aria-label="Breadcrumb" className="hidden items-center gap-1 pb-4 text-sm text-muted md:flex">
        <Link href="/" className="hover:text-navy">
          {copy.brand.name}
        </Link>
        {mainCategory ? (
          <>
            <ChevronRight className="size-4" />
            <Link href={`/c/${mainCategory.slug}`} className="hover:text-navy">
              {mainCategory.name}
            </Link>
          </>
        ) : null}
        <ChevronRight className="size-4" />
        <span className="truncate text-ink">{item.name}</span>
      </nav>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-10">
        <div className="-mx-4 md:sticky md:top-24 md:mx-0 md:self-start">
          <ProductGallery photos={item.photos} name={item.name} />
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-2">
            {item.categories.length > 0 || item.badge ? (
              <div className="-mb-2 flex flex-wrap items-center gap-x-3">
                {item.badge ? <Badge badge={item.badge} /> : null}
                {item.categories.map((c) => (
                  <Link key={c.slug} href={`/c/${c.slug}`} className="inline-flex min-h-12 items-center text-xs font-semibold tracking-[0.12em] text-orange-text uppercase hover:underline md:min-h-8">
                    {c.name}
                  </Link>
                ))}
              </div>
            ) : null}
            <h1 className="text-[28px] md:text-[40px]">{item.name}</h1>
          </div>

          <ItemPurchase
            item={{
              kind: item.kind,
              slug: item.slug,
              name: item.name,
              price: item.price,
              compareAtPrice: item.compareAtPrice,
              stock: item.stock,
              choiceGroups: item.choiceGroups,
              contents: item.contents,
              printPhotos: item.printPhotos,
              printCards: item.printCards,
            }}
            chat={chat}
            currencies={currencies}
          />

          {item.description.length > 0 ? (
            <section aria-labelledby="about">
              <h2 id="about" className="mb-2 text-xl">
                {copy.product.details}
              </h2>
              <RichText blocks={item.description} className="text-[15px] text-body" />
            </section>
          ) : null}

          <DeliveryBox delivery={item.delivery} times={settings.deliveryTimes} policy={!!settings.policies.delivery} />
        </div>
      </div>

      {/* W-8 — structured data for search engines: name, photos, price, In stock / Out of stock. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(productJsonLd(item, storefrontOrigin())) }} />
      {/* W-8 — Meta ViewContent (browser + server, one event_id; nothing while tracking is off). */}
      <MetaViewContent slug={item.slug} name={item.name} price={item.price} />

      {related.length > 0 ? (
        <section className="pt-12" aria-labelledby="related">
          <h2 id="related" className="mb-4 text-2xl md:text-3xl">
            {mainCategory ? copy.product.moreOf(mainCategory.name) : copy.product.more}
          </h2>
          <ProductGrid items={related} />
        </section>
      ) : null}
    </div>
  );
}

function DeliveryBox({ delivery, times, policy }: { delivery: WebDelivery; times: WebSettings["deliveryTimes"]; policy: boolean }) {
  const zones = (["insideDhaka", "subDhaka", "outsideDhaka"] as const).map((z) => ({
    label: copy.product.zones[z],
    charge: delivery[z] > 0 ? formatTaka(delivery[z]) : copy.product.free,
    time: times[z],
  }));
  return (
    <section className="rounded-card border border-line bg-white p-4 text-[15px]" aria-labelledby="delivery">
      <h2 id="delivery" className="mb-2 flex items-center gap-2 text-xl">
        <Truck className="size-5 text-orange-text" /> {copy.product.delivery}
      </h2>
      <p className="mb-2 font-medium text-ink">{copy.product.deliveredAnywhere}</p>
      <ul className="mb-3 divide-y divide-line">
        {zones.map((z) => (
          <li key={z.label} className="flex items-baseline justify-between gap-3 py-1.5">
            <span>
              {z.label}
              {z.time ? <span className="text-muted"> · {z.time}</span> : null}
            </span>
            <span className="font-semibold text-navy">{z.charge}</span>
          </li>
        ))}
      </ul>
      <p className="text-muted">{copy.product.confirmLine}</p>
      {policy ? (
        <Link href="/policy/delivery" className="mt-1 inline-flex min-h-12 items-center text-navy underline underline-offset-4">
          {POLICY_TITLES.delivery}
        </Link>
      ) : null}
    </section>
  );
}
