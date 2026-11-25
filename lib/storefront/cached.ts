import { unstable_cache } from "next/cache";
import {
  getWebCategory,
  getWebItem,
  getWebSettings,
  listWebCategories,
  listWebCurrencies,
  listWebItems,
  relatedWebItems,
} from "./catalog";
import { STOREFRONT_REVALIDATE_SECONDS, STOREFRONT_TAGS } from "./revalidate";
import type { WebCard, WebCategory } from "./types";

// ROUND3 W-9 — the website's reads, cached on the server under the tags in
// ./revalidate.ts (which also says what clears each one). The pages built
// from them are cached with the same tags. Search, the bag, checkout and
// /api/shop/* never read through here: search is per query, and price and
// stock are always checked live at the moment of ordering (W-5).

const opts = (tags: string[]) => ({ tags, revalidate: STOREFRONT_REVALIDATE_SECONDS });
const CATALOG = [STOREFRONT_TAGS.catalog];
const SETTINGS = [STOREFRONT_TAGS.settings];

export const cachedSettings = unstable_cache(() => getWebSettings(), ["sf-settings"], opts(SETTINGS));

export const cachedCurrencies = unstable_cache(() => listWebCurrencies(), ["sf-currencies"], opts(SETTINGS));

export const cachedCategories = unstable_cache(() => listWebCategories(), ["sf-categories"], opts(CATALOG));

export const cachedCategoryPage = unstable_cache((slug: string) => getWebCategory(slug), ["sf-category"], opts(CATALOG));

export const cachedItem = unstable_cache((slug: string) => getWebItem(slug), ["sf-item"], opts(CATALOG));

export const cachedRelated = unstable_cache((slug: string) => relatedWebItems(slug), ["sf-related"], opts(CATALOG));

export type HomeData = {
  /** The featured categories, or every shown one when none is featured. */
  categories: WebCategory[];
  featured: WebCard[];
  /** The "Customize Chocolate Box" highlight: the first shown item whose print kit asks for photos. */
  customize: WebCard | null;
  all: WebCard[];
};

const HOME_ALL = 24;

/**
 * The home page's sections. Until the home page manager (W-7) exists the
 * order is fixed: banner, categories, featured, the photo-box highlight, all
 * gifts. Cleared with the catalog and when the home page is published.
 */
export const cachedHome = unstable_cache(
  async (): Promise<HomeData> => {
    const [categories, featured, everything] = await Promise.all([
      listWebCategories(),
      listWebItems({ featured: true, take: 12 }),
      listWebItems({ take: 200 }),
    ]);
    const featuredCategories = categories.filter((c) => c.featured);
    return {
      categories: featuredCategories.length > 0 ? featuredCategories : categories,
      featured,
      customize: everything.find((c) => c.printPhotos > 0) ?? null,
      all: everything.slice(0, HOME_ALL),
    };
  },
  ["sf-home"],
  opts([STOREFRONT_TAGS.home, STOREFRONT_TAGS.catalog])
);
