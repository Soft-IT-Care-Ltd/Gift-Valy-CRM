"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { WebPhoto } from "@/components/storefront/web-photo";
import { copy } from "@/lib/storefront/copy";
import type { WebImage } from "@/lib/storefront/types";

// ROUND3 W-4 — full-width square photos swiped through on a phone (dots
// under them), arrows to step, and the photos in a row underneath on a wide
// screen to jump straight to one. No photo yet → the branded placeholder.
export function ProductGallery({ photos, name }: { photos: WebImage[]; name: string }) {
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  if (photos.length === 0) {
    return (
      <div className="sf-photo md:rounded-card">
        <WebPhoto image={null} name={name} />
      </div>
    );
  }
  const many = photos.length > 1;

  function show(i: number) {
    const el = track.current;
    if (!el) return;
    const next = (i + photos.length) % photos.length;
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    setIndex(next);
  }

  return (
    <div>
      <div className="relative">
        <div
          ref={track}
          className="sf-gallery aspect-square bg-orange-50 md:rounded-card"
          aria-label={copy.images.gallery(name)}
          onScroll={(e) => {
            const el = e.currentTarget;
            setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
          }}
        >
          {photos.map((p, i) => (
            <div key={p.path} className="sf-photo">
              <WebPhoto image={p} name={name} sizes="(min-width: 768px) 50vw, 100vw" priority={i === 0} />
            </div>
          ))}
        </div>
        {many ? (
          <>
            <button
              type="button"
              onClick={() => show(index - 1)}
              aria-label={copy.images.previous}
              className="absolute top-1/2 left-2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-navy shadow-[var(--shadow-card)] hover:bg-white"
            >
              <ChevronLeft className="size-6" />
            </button>
            <button
              type="button"
              onClick={() => show(index + 1)}
              aria-label={copy.images.next}
              className="absolute top-1/2 right-2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-navy shadow-[var(--shadow-card)] hover:bg-white"
            >
              <ChevronRight className="size-6" />
            </button>
          </>
        ) : null}
      </div>
      {many ? (
        <div className="mt-2 flex justify-center gap-1.5 md:hidden" aria-live="polite">
          <span className="sf-visually-hidden">{copy.images.position(index + 1, photos.length)}</span>
          {photos.map((p, i) => (
            <span key={p.path} aria-hidden className={`size-2 rounded-full transition-colors ${i === index ? "bg-navy" : "bg-line-strong"}`} />
          ))}
        </div>
      ) : null}
      {many ? (
        <div className="mt-3 hidden flex-wrap gap-2 md:flex">
          {photos.map((p, i) => (
            <button
              key={p.path}
              type="button"
              onClick={() => show(i)}
              aria-label={copy.images.show(i + 1)}
              aria-current={i === index ? "true" : undefined}
              className={`sf-photo w-16 rounded-ctl border-2 ${i === index ? "border-navy" : "border-transparent hover:border-line-strong"}`}
            >
              <WebPhoto image={p} name={name} sizes="64px" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
