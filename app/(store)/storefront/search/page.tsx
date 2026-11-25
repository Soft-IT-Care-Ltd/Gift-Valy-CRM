import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { ProductGrid } from "@/components/storefront/product-card";
import { cachedCategories } from "@/lib/storefront/cached";
import { searchWebItems } from "@/lib/storefront/catalog";
import { copy } from "@/lib/storefront/copy";

// ROUND3 W-4 — search, /search?q=: Bangla or English, by name, address or
// category ("saree" finds a Bangla-named saree through its Latin address).
// Per query, so never cached as a page; never indexed.
export const metadata: Metadata = { title: copy.search.title, robots: { index: false } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 80) ?? "";
  const [results, categories] = await Promise.all([q ? searchWebItems(q) : Promise.resolve([]), cachedCategories()]);
  return (
    <div className="sf-container pt-5 md:pt-8">
      <h1 className="mb-4 text-[28px] md:text-4xl">{copy.search.heading}</h1>
      <form action="/search" method="get" role="search" className="flex gap-2">
        <label htmlFor="sf-q" className="sf-visually-hidden">
          {copy.search.label}
        </label>
        <input id="sf-q" name="q" type="search" defaultValue={q} autoFocus={!q} placeholder={copy.search.placeholder} enterKeyHint="search" className="sf-field" />
        <button type="submit" className="sf-btn sf-btn-navy shrink-0 px-4" aria-label={copy.search.button}>
          <Search className="size-5" />
          <span className="hidden sm:inline">{copy.search.button}</span>
        </button>
      </form>
      <div className="pt-6">
        {!q ? null : results.length > 0 ? (
          <>
            <p className="mb-4 text-[15px] text-muted">{copy.search.results(q, results.length)}</p>
            <ProductGrid items={results} priorityFirst={2} />
          </>
        ) : (
          <p className="rounded-card border border-line bg-white p-6 text-center text-muted">{copy.search.none(q)}</p>
        )}
      </div>
      {categories.length > 0 && results.length === 0 ? (
        <section className="pt-8" aria-labelledby="browse">
          <h2 id="browse" className="mb-3 text-xl">
            {copy.search.browse}
          </h2>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <Link
                key={c.slug}
                href={`/c/${c.slug}`}
                className="flex min-h-12 items-center rounded-full border border-line-strong bg-white px-4 text-[15px] font-medium text-navy hover:bg-navy-50"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
