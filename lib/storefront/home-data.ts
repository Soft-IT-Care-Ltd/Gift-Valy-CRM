import { parseRichText } from "@/lib/catalog-website-shape";
import { dhakaLocalToUtc, type BannerImage, type HomeLayout } from "@/lib/home-page/layout";
import {
  listWebCategories,
  listWebItems,
  webCategoriesByIds,
  webCategoryCards,
  webItemsByRefs,
  type Db,
} from "./catalog";
import type { HomeBlock, HomeView, WebBannerImage } from "./home-types";
import { BANNER_WIDTHS } from "./images";
import type { WebCard } from "./types";

// ROUND3 W-7 — a home page layout (the published one, or the draft for the
// signed preview) resolved into what each section shows. Every read goes
// through the one catalog gate (./catalog.ts). A section with nothing to
// show (no featured items, an empty category, every banner over) is left out.

function bannerImage(img: BannerImage | null): WebBannerImage | null {
  if (!img) return null;
  const base = img.file.replace(/\.webp$/, "");
  const widths = BANNER_WIDTHS.filter((w) => w <= img.width);
  const use = widths.length > 0 ? widths : [BANNER_WIDTHS[0]];
  const name = (w: number) => `/img/${base}-${w}.webp`;
  return { src: name(use[use.length - 1]), srcSet: use.map((w) => `${name(w)} ${w}w`).join(", "), width: img.width, height: img.height };
}

const iso = (local: string | null) => (local ? dhakaLocalToUtc(local).toISOString() : null);

export async function buildHomeView(layout: HomeLayout, db?: Db, now: Date = new Date()): Promise<HomeView> {
  // Shared between sections: read once.
  let everything: Promise<WebCard[]> | null = null;
  const all = () => (everything ??= listWebItems({ take: 200 }, db));

  const blocks = await Promise.all(
    layout.sections.map(async (s): Promise<HomeBlock | null> => {
      if (!s.enabled) return null;
      switch (s.kind) {
        case "banners": {
          const items = s.items
            .filter((b) => b.enabled && (!b.endsAt || dhakaLocalToUtc(b.endsAt) > now))
            .map((b) => ({
              key: b.id,
              text: b.text,
              subtext: b.subtext,
              link: b.link,
              placeholder: b.placeholder,
              desktop: b.placeholder ? null : bannerImage(b.desktop),
              mobile: b.placeholder ? null : bannerImage(b.mobile),
              startsAt: iso(b.startsAt),
              endsAt: iso(b.endsAt),
            }))
            .filter((b) => b.placeholder || (b.desktop && b.mobile));
          return items.length ? { kind: "banners", key: s.id, items } : null;
        }
        case "categories": {
          let categories;
          if (s.mode === "HAND") categories = await webCategoriesByIds(s.categoryIds, db);
          else {
            const shown = await listWebCategories(db);
            const featured = shown.filter((c) => c.featured);
            categories = featured.length > 0 ? featured : shown;
          }
          return categories.length ? { kind: "categories", key: s.id, title: s.title, categories } : null;
        }
        case "items": {
          if (s.mode === "CATEGORY") {
            const cat = s.categoryId ? await webCategoryCards(s.categoryId, s.count, db) : null;
            return cat && cat.items.length ? { kind: "items", key: s.id, title: s.title || cat.name, items: cat.items, moreHref: `/c/${cat.slug}` } : null;
          }
          const items = s.mode === "HAND" ? (await webItemsByRefs(s.refs, db)).slice(0, s.count) : await listWebItems({ featured: true, take: s.count }, db);
          return items.length ? { kind: "items", key: s.id, title: s.title, items, moreHref: null } : null;
        }
        case "photo_box": {
          const item = s.ref ? (await webItemsByRefs([s.ref], db))[0] : (await all()).find((c) => c.printPhotos > 0);
          return item ? { kind: "photo_box", key: s.id, item } : null;
        }
        case "text": {
          const body = parseRichText(s.body);
          if (!s.title && body.length === 0) return null;
          return { kind: "text", key: s.id, title: s.title, body, button: s.buttonLabel && s.buttonLink ? { label: s.buttonLabel, link: s.buttonLink } : null };
        }
        case "all": {
          const items = (await all()).slice(0, s.count);
          return items.length ? { kind: "all", key: s.id, title: s.title, items } : null;
        }
        case "promises":
          return { kind: "promises", key: s.id };
      }
    })
  );
  return { blocks: blocks.filter((b): b is HomeBlock => b !== null), builtAt: now.toISOString() };
}
