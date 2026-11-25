import type { WebImage } from "@/lib/storefront/types";

// ROUND3 W-2/W-3 — a website photo at the right size, or, when the item has
// none yet, the branded placeholder (the Gift Valy logo on the brand colour
// with the item's name) — never a broken image.

const srcSet = (img: WebImage) => `${img.path}-360.webp 360w, ${img.path}-720.webp 720w, ${img.path}-1080.webp 1080w`;

export function WebPhoto({
  image,
  name,
  sizes = "(min-width: 768px) 33vw, 50vw",
  className = "",
  priority = false,
}: {
  image: WebImage | null;
  name: string;
  sizes?: string;
  className?: string;
  priority?: boolean;
}) {
  if (!image) {
    return (
      <div
        role="img"
        aria-label={name}
        className={`flex aspect-square flex-col items-center justify-center gap-3 bg-brand-50 p-4 text-center ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/shop/logo.png" alt="" className="w-1/2 max-w-40 opacity-90" />
        <span className="line-clamp-2 text-sm font-medium text-brand">{name}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${image.path}-720.webp`}
      srcSet={srcSet(image)}
      sizes={sizes}
      alt={image.alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={`aspect-square object-cover ${className}`}
    />
  );
}
