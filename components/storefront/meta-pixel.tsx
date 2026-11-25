"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { setPixel, trackBrowse } from "@/lib/storefront/meta-pixel";

// ROUND3 W-8 — on every website page: loads the Meta Pixel while tracking is
// on and sends a PageView for each page opened (browser + server, one
// event_id). Never on a customer's private order page (its address is her
// receipt link) or a staff preview. Renders nothing.
export function MetaPixel({ pixelId }: { pixelId: string | null }) {
  const pathname = usePathname();
  useEffect(() => {
    setPixel(pixelId);
  }, [pixelId]);
  useEffect(() => {
    if (/^\/(storefront\/)?(order|preview)(\/|$)/.test(pathname)) return;
    trackBrowse("PageView");
  }, [pathname]);
  return null;
}

/** A product / package page: ViewContent, once per item opened, at its starting price. */
export function MetaViewContent({ slug, name, price }: { slug: string; name: string; price: number }) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (sent.current === slug) return;
    sent.current = slug;
    trackBrowse("ViewContent", { content_ids: [slug], content_type: "product", content_name: name, currency: "BDT", value: price }, { product: slug });
  }, [slug, name, price]);
  return null;
}
