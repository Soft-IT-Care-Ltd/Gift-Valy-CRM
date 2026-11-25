import type { WebImage } from "@/lib/storefront/types";

// ROUND3 W-2/W-4 — a website photo at the right size (the phone picks 360,
// 720 or 1080 px), or, when the item has none yet, the branded placeholder:
// the Gift Valy gift box on the brand's light orange with the item's name —
// never a broken image. Fills its box (the parent sets the shape: .sf-photo).

const srcSet = (img: WebImage) => `${img.path}-360.webp 360w, ${img.path}-720.webp 720w, ${img.path}-1080.webp 1080w`;

export function WebPhoto({
  image,
  name,
  sizes = "(min-width: 1024px) 280px, (min-width: 640px) 33vw, 50vw",
  className = "",
  priority = false,
  showName = true,
}: {
  image: WebImage | null;
  name: string;
  sizes?: string;
  className?: string;
  priority?: boolean;
  /** The name under the gift box (off for tiny thumbnails). */
  showName?: boolean;
}) {
  if (!image) {
    return (
      <div
        role="img"
        aria-label={name}
        className={`absolute inset-0 flex flex-col items-center justify-center gap-2 bg-orange-50 p-3 text-center ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/shop/icon.png" alt="" className="w-2/5 max-w-36 rounded-[18%] opacity-95 mix-blend-multiply" />
        {showName ? <span className="line-clamp-2 font-display text-[13px] leading-tight font-semibold text-navy sm:text-sm">{name}</span> : null}
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
      {...(priority ? { fetchPriority: "high" as const } : {})}
      className={`absolute inset-0 size-full object-cover ${className}`}
    />
  );
}
