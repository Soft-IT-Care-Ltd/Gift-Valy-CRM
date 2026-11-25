import type { RichBlock } from "@/lib/catalog-website-shape";
import type { WebCard, WebCategory } from "./types";

// ROUND3 W-7 — the home page as the website renders it: each published
// section resolved into what it shows. Client-safe; only public fields
// (cards, category tiles, banner photos and their times).

export type WebBannerImage = { src: string; srcSet: string; width: number; height: number };

export type WebBanner = {
  key: string;
  text: string;
  subtext: string;
  link: string;
  /** Drawn by the website in the brand colours with its text, until the real photos arrive. */
  placeholder: boolean;
  desktop: WebBannerImage | null;
  mobile: WebBannerImage | null;
  /** ISO; the banner shows only between them. */
  startsAt: string | null;
  endsAt: string | null;
};

export type HomeBlock =
  | { kind: "banners"; key: string; items: WebBanner[] }
  | { kind: "categories"; key: string; title: string; categories: WebCategory[] }
  | { kind: "items"; key: string; title: string; items: WebCard[]; moreHref: string | null }
  | { kind: "photo_box"; key: string; item: WebCard }
  | { kind: "text"; key: string; title: string; body: RichBlock[]; button: { label: string; link: string } | null }
  | { kind: "all"; key: string; title: string; items: WebCard[] }
  | { kind: "promises"; key: string };

export type HomeView = {
  blocks: HomeBlock[];
  /** When the page was built (ISO) — the banner slider's first render uses it, then the visitor's clock. */
  builtAt: string;
};
