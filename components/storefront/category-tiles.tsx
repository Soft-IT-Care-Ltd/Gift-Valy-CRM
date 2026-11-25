import Link from "next/link";
import { WebPhoto } from "@/components/storefront/web-photo";
import type { WebCategory } from "@/lib/storefront/types";

// ROUND3 W-4 / R3-1 — category tiles: the category photo, or a plain tile
// with the name when it has none. A scrolling row on a phone, a grid wider.
export function CategoryTiles({ categories }: { categories: WebCategory[] }) {
  return (
    <div className="sf-scroll-x -mx-4 gap-3 px-4 pb-1 md:mx-0 md:grid md:grid-cols-5 md:gap-4 md:overflow-visible md:px-0 lg:grid-cols-8">
      {categories.map((c) => (
        <Link key={c.slug} href={`/c/${c.slug}`} className="group flex w-[30vw] max-w-36 shrink-0 flex-col gap-2 md:w-auto md:max-w-none">
          {c.image ? (
            <span className="sf-photo rounded-card shadow-[var(--shadow-card)]">
              <WebPhoto image={c.image} name={c.name} sizes="(min-width: 768px) 200px, 30vw" className="transition-transform duration-300 group-hover:scale-[1.04]" />
            </span>
          ) : (
            <span className="grid aspect-square place-items-center rounded-card border border-line bg-gradient-to-br from-orange-50 to-navy-50 p-2 text-center font-display text-[17px] leading-tight font-bold text-navy shadow-[var(--shadow-card)] group-hover:border-navy md:text-xl">
              {c.name}
            </span>
          )}
          {c.image ? <span className="text-center text-[15px] font-semibold text-navy">{c.name}</span> : null}
        </Link>
      ))}
    </div>
  );
}
