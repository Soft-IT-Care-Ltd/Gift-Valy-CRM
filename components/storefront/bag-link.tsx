"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useBagCount } from "@/lib/storefront/bag-store";
import { copy } from "@/lib/storefront/copy";

// ROUND3 W-4 — the bag icon with its count (the bag page itself is W-5).
export function BagLink() {
  const count = useBagCount();
  return (
    <Link
      href="/bag"
      className="relative grid size-12 place-items-center rounded-full text-navy hover:bg-navy-50"
      aria-label={count > 0 ? copy.header.bagWithCount(count) : copy.header.bag}
    >
      <ShoppingBag className="size-6" strokeWidth={2.2} />
      {count > 0 ? (
        <span className="absolute top-1 right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-orange px-1 text-[12px] leading-none font-bold text-navy-800">
          {count}
        </span>
      ) : null}
    </Link>
  );
}
