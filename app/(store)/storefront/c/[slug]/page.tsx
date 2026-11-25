import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { ProductGrid } from "@/components/storefront/product-card";
import { RichText } from "@/components/storefront/rich-text";
import { WebPhoto } from "@/components/storefront/web-photo";
import { cachedCategoryPage } from "@/lib/storefront/cached";
import { copy } from "@/lib/storefront/copy";
import { ogPhoto } from "@/lib/storefront/seo";

// ROUND3 W-4 — a category, /c/<slug>: its products and packages in the
// shop's display order. Cached like an item page; an old address redirects.
export const revalidate = 600;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await cachedCategoryPage((await params).slug);
  if (!page || !("category" in page)) return { title: copy.meta.notFound, robots: { index: false } };
  const c = page.category;
  const description = c.seoDescription || copy.meta.pageDescription(c.name);
  return {
    title: c.seoTitle,
    description,
    alternates: { canonical: `/c/${c.slug}` },
    openGraph: { title: c.seoTitle, description, url: `/c/${c.slug}`, images: [{ ...ogPhoto(c.image?.path), alt: c.name }] },
    twitter: { card: "summary_large_image", title: c.seoTitle, description, images: [ogPhoto(c.image?.path).url] },
  };
}

export default async function CategoryPage({ params }: Props) {
  const page = await cachedCategoryPage((await params).slug);
  if (!page) notFound();
  if ("redirectTo" in page) permanentRedirect(`/c/${page.redirectTo}`);
  const { category, items } = page;
  return (
    <div className="sf-container pt-5 md:pt-6">
      <nav aria-label="Breadcrumb" className="mb-3 hidden items-center gap-1 text-sm text-muted md:flex">
        <Link href="/" className="hover:text-navy">
          {copy.brand.name}
        </Link>
        <ChevronRight className="size-4" />
        <span className="text-ink">{category.name}</span>
      </nav>
      <div className="mb-6 flex items-center gap-4">
        {category.image ? (
          <span className="sf-photo size-16 shrink-0 rounded-card md:size-20">
            <WebPhoto image={category.image} name={category.name} sizes="80px" priority />
          </span>
        ) : null}
        <div className="min-w-0">
          <h1 className="text-[28px] md:text-4xl">{category.name}</h1>
          <p className="text-sm text-muted">{copy.category.count(items.length)}</p>
        </div>
      </div>
      {category.description.length > 0 ? <RichText blocks={category.description} className="mb-6 max-w-3xl text-[15px]" /> : null}
      {items.length > 0 ? (
        <ProductGrid items={items} priorityFirst={2} />
      ) : (
        <p className="rounded-card border border-line bg-white p-6 text-center text-muted">{copy.category.empty}</p>
      )}
    </div>
  );
}
