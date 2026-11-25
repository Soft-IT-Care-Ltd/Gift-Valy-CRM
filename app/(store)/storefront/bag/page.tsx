import type { Metadata } from "next";
import { BagView } from "@/components/storefront/bag-view";
import { copy } from "@/lib/storefront/copy";

// ROUND3 W-5 — the bag. It lives in the visitor's browser; the page re-reads
// every line from the server (today's price, stock). Never indexed.
// W-9 — the bag and checkout are never cached (their data is the browser's
// and /api/shop/*, both no-store); the shell is rendered per request too.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.bag.title, robots: { index: false, follow: false } };

export default function BagPage() {
  return (
    <div className="sf-container pt-6 pb-10">
      <h1 className="mb-4 text-3xl">{copy.bag.title}</h1>
      <BagView />
    </div>
  );
}
