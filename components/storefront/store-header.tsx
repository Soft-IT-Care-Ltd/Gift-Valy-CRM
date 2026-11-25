import Link from "next/link";
import { Search } from "lucide-react";
import { BagLink } from "@/components/storefront/bag-link";
import { cachedCategories } from "@/lib/storefront/cached";
import { copy } from "@/lib/storefront/copy";

// ROUND3 W-4 — a navy strip, then a sticky white header: the logo, the
// categories (a menu row on a wide screen; on a phone a scrolling row of
// chips under the header), search and the bag. Every tap target is at least 48 px.
export async function StoreHeader() {
  const categories = await cachedCategories();
  return (
    <>
      <div className="bg-navy px-4 py-1.5 text-center text-[13px] leading-snug font-medium text-white">{copy.header.topStrip}</div>
      <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/90">
        <div className="sf-container flex h-16 items-center gap-3">
          <Link href="/" className="flex min-h-12 shrink-0 items-center" aria-label={copy.header.home}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/shop/logo.png" alt="Gift Valy" width={163} height={49} className="h-10 w-auto md:h-11" />
          </Link>
          <nav aria-label={copy.header.categories} className="mx-auto hidden min-w-0 items-center gap-1 lg:flex">
            {categories.slice(0, 7).map((c) => (
              <Link
                key={c.slug}
                href={`/c/${c.slug}`}
                className="flex min-h-12 items-center rounded-full px-3 text-[15px] font-medium whitespace-nowrap text-navy hover:bg-navy-50"
              >
                {c.name}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1 lg:ml-0">
            <Link href="/search" className="grid size-12 place-items-center rounded-full text-navy hover:bg-navy-50" aria-label={copy.header.search}>
              <Search className="size-6" strokeWidth={2.2} />
            </Link>
            <BagLink />
          </div>
        </div>
      </header>
      {categories.length > 0 ? (
        // Phones and tablets: the categories as a row of chips under the header (it scrolls away; the header stays).
        <nav aria-label={copy.header.categories} className="border-b border-line bg-white lg:hidden">
          <div className="sf-scroll-x gap-2 px-4 py-2">
            {categories.map((c) => (
              <Link
                key={c.slug}
                href={`/c/${c.slug}`}
                className="flex min-h-12 shrink-0 items-center rounded-full border border-line-strong bg-white px-4 text-[15px] font-medium whitespace-nowrap text-navy"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </>
  );
}
