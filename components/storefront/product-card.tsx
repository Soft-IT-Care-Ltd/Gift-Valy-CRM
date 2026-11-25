import Link from "next/link";
import { WebPhoto } from "@/components/storefront/web-photo";
import { copy } from "@/lib/storefront/copy";
import { formatTaka } from "@/lib/storefront/format";
import type { WebBadge, WebCard } from "@/lib/storefront/types";

// ROUND3 W-4 — a gift tile: square photo, badge, name, price (with the
// default choices for a package), "was" price. Out of stock says so on the
// photo; never a number.

export function Badge({ badge, className = "" }: { badge: Exclude<WebBadge, null>; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full bg-orange px-2.5 py-0.5 text-[12px] font-bold text-navy-800 ${className}`}>
      {copy.card.badge[badge]}
    </span>
  );
}

export function ProductCard({ item, priority = false }: { item: WebCard; priority?: boolean }) {
  const out = item.stock === "OUT_OF_STOCK";
  return (
    <Link href={`/p/${item.slug}`} className="group flex flex-col overflow-hidden rounded-card bg-white shadow-[var(--shadow-card)]">
      <div className="sf-photo">
        <WebPhoto image={item.image} name={item.name} priority={priority} className="transition-transform duration-300 group-hover:scale-[1.03]" />
        <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
          {item.badge ? <Badge badge={item.badge} /> : null}
          {out ? <span className="rounded-full bg-white/95 px-2.5 py-0.5 text-[12px] font-semibold text-bad">{copy.card.outOfStock}</span> : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 min-h-[2.6em] text-[15px] leading-snug font-medium text-ink group-hover:underline group-hover:underline-offset-4">
          {item.name}
        </p>
        <p className="mt-auto flex flex-wrap items-baseline gap-x-2 text-[16px] font-bold text-navy">
          {formatTaka(item.price)}
          {item.compareAtPrice && item.compareAtPrice > item.price ? <s className="text-[13px] font-normal text-muted">{formatTaka(item.compareAtPrice)}</s> : null}
        </p>
      </div>
    </Link>
  );
}

export function ProductGrid({ items, priorityFirst = 0 }: { items: WebCard[]; priorityFirst?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5">
      {items.map((c, i) => (
        <ProductCard key={`${c.kind}-${c.slug}`} item={c} priority={i < priorityFirst} />
      ))}
    </div>
  );
}
