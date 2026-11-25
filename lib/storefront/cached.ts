import { unstable_cache } from "next/cache";
import {
  getHomeLayout,
  getWebCategory,
  getWebItem,
  getWebPixelId,
  getWebSettings,
  listWebAddresses,
  listWebCategories,
  listWebCurrencies,
  relatedWebItems,
} from "./catalog";
import { buildHomeView } from "./home-data";
import type { HomeView } from "./home-types";
import { STOREFRONT_REVALIDATE_SECONDS, STOREFRONT_TAGS } from "./revalidate";

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

/**
 * ROUND3 W-7 — the home page: the PUBLISHED layout from the home page manager
 * (the starting layout until the first publish), each section resolved
 * through the gate (./home-data.ts). Cleared when the home page is published
 * and with the catalog.
 */
export const cachedHome = unstable_cache(
  async (): Promise<HomeView> => buildHomeView(await getHomeLayout("published")),
  ["sf-home"],
  opts([STOREFRONT_TAGS.home, STOREFRONT_TAGS.catalog])
);

/** ROUND3 W-8 — the Meta Pixel the website loads (null = tracking off). Cleared by Settings → Website → Meta Pixel. */
export const cachedPixelId = unstable_cache(() => getWebPixelId(), ["sf-pixel"], opts(SETTINGS));

/** ROUND3 W-8 — sitemap.xml: every shown category and item. */
export const cachedSitemap = unstable_cache(() => listWebAddresses(), ["sf-sitemap"], opts(CATALOG));
