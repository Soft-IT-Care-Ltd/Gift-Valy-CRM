"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { whatsappLink } from "@/lib/storefront/chat";
import { copy } from "@/lib/storefront/copy";
import type { WebBanner } from "@/lib/storefront/home-types";

// ROUND3 W-7 — the home page's banner slider: a desktop and a mobile photo
// for each banner (the browser picks one by screen width), swiped sideways on
// a phone, arrows and dots on a computer, turning by itself every 6 seconds
// unless the visitor has touched it or asked for reduced motion. A
// placeholder banner is drawn here in the brand colours with its text.
// Show-from / show-until: the page is built with the banners that haven't
// ended; the first render uses the build time (so it matches the server's
// HTML), then the visitor's clock takes over, checked every minute.

const ROTATE_MS = 6000;

function visibleAt(items: WebBanner[], now: number) {
  return items.filter((b) => (!b.startsAt || Date.parse(b.startsAt) <= now) && (!b.endsAt || Date.parse(b.endsAt) > now));
}

function BannerLink({ link, className, children, label }: { link: string; className: string; children: React.ReactNode; label?: string }) {
  if (!link) return <div className={className}>{children}</div>;
  const external = link.startsWith("https://");
  return (
    <a href={link} className={className} aria-label={label} {...(external ? { target: "_blank", rel: "noopener" } : {})}>
      {children}
    </a>
  );
}

function Placeholder({ b, whatsapp, first }: { b: WebBanner; whatsapp: string; first: boolean }) {
  return (
    <div className="bg-gradient-to-br from-orange-50 via-cream to-navy-50">
      <div className="sf-container grid min-h-[300px] items-center gap-6 py-8 md:min-h-[380px] md:grid-cols-[1.3fr_1fr] md:py-14">
        <div className="flex flex-col gap-4">
          <p className="font-display text-[34px] leading-[1.1] font-bold text-navy md:text-[56px]">{b.text}</p>
          {b.subtext ? <p className="max-w-xl text-[17px] text-body md:text-lg">{b.subtext}</p> : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            {b.link ? (
              <BannerLink link={b.link} className="sf-btn sf-btn-navy">
                <>
                  {copy.home.heroCta} <ArrowRight className="size-5" />
                </>
              </BannerLink>
            ) : null}
            {first && whatsapp ? (
              <a href={whatsappLink(whatsapp, "")} target="_blank" rel="noopener" className="sf-btn sf-btn-whatsapp">
                {copy.home.heroChat}
              </a>
            ) : null}
          </div>
        </div>
        <div className="hidden justify-center md:flex">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/shop/icon.png" alt="" width={320} height={320} className="size-72 rounded-[28%] mix-blend-multiply" />
        </div>
      </div>
    </div>
  );
}

function Photo({ b, eager }: { b: WebBanner; eager: boolean }) {
  const d = b.desktop!;
  const m = b.mobile!;
  return (
    <BannerLink link={b.link} className="block" label={b.link ? b.text : undefined}>
      <picture
        className="sf-banner block w-full overflow-hidden bg-navy-50"
        style={{ "--m-ar": `${m.width} / ${m.height}`, "--d-ar": `${d.width} / ${d.height}` } as React.CSSProperties}
      >
        <source media="(min-width: 768px)" srcSet={d.srcSet} sizes="100vw" width={d.width} height={d.height} />
        <img
          src={m.src}
          srcSet={m.srcSet}
          sizes="100vw"
          width={m.width}
          height={m.height}
          alt={b.text}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          decoding="async"
          className="size-full object-cover"
        />
      </picture>
    </BannerLink>
  );
}

export function BannerSlider({ items, builtAt, whatsapp }: { items: WebBanner[]; builtAt: string; whatsapp: string }) {
  const [now, setNow] = useState(() => Date.parse(builtAt));
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, []);

  const shown = visibleAt(items, now);
  const count = shown.length;

  const go = (i: number) => {
    const el = track.current;
    if (!el || count === 0) return;
    const next = (i + count) % count;
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  };

  useEffect(() => {
    if (count < 2 || touched || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => {
      const el = track.current;
      if (!el || document.hidden) return;
      const i = Math.round(el.scrollLeft / el.clientWidth);
      el.scrollTo({ left: ((i + 1) % count) * el.clientWidth, behavior: "smooth" });
    }, ROTATE_MS);
    return () => window.clearInterval(t);
  }, [count, touched]);

  if (count === 0) return null;
  return (
    <section aria-roledescription="carousel" aria-label={copy.banners.bannerLabel} className="relative">
      <div
        ref={track}
        className="sf-no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
        onScroll={(e) => setActive(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
        onPointerDown={() => setTouched(true)}
        onFocus={() => setTouched(true)}
      >
        {shown.map((b, i) => (
          <div key={b.key} className="w-full shrink-0 snap-start" role="group" aria-roledescription="slide" aria-label={`${i + 1} / ${count}`}>
            {b.placeholder ? <Placeholder b={b} whatsapp={whatsapp} first={i === 0} /> : <Photo b={b} eager={i === 0} />}
          </div>
        ))}
      </div>
      {count > 1 ? (
        <>
          <button
            type="button"
            onClick={() => {
              setTouched(true);
              go(active - 1);
            }}
            className="absolute top-1/2 left-3 hidden size-12 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-navy shadow-[var(--shadow-card)] hover:bg-white md:grid"
            aria-label={copy.banners.previous}
          >
            <ChevronLeft className="size-6" />
          </button>
          <button
            type="button"
            onClick={() => {
              setTouched(true);
              go(active + 1);
            }}
            className="absolute top-1/2 right-3 hidden size-12 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-navy shadow-[var(--shadow-card)] hover:bg-white md:grid"
            aria-label={copy.banners.next}
          >
            <ChevronRight className="size-6" />
          </button>
          <div className="flex justify-center gap-1 py-2">
            {shown.map((b, i) => (
              <button
                key={b.key}
                type="button"
                onClick={() => {
                  setTouched(true);
                  go(i);
                }}
                className="grid size-8 place-items-center"
                aria-label={copy.banners.goTo(i + 1)}
                aria-current={i === active ? "true" : undefined}
              >
                <span className={`block h-2 rounded-full transition-all ${i === active ? "w-6 bg-navy" : "w-2 bg-navy-100"}`} />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
