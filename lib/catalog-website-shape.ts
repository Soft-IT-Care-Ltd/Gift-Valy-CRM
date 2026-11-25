import { z } from "zod";

// ROUND3 W-2 — the Website panel's shape, shared by the catalog forms (client)
// and lib/catalog-website.ts (server). Pure and client-safe.

export const WEBSITE_BADGES = ["NONE", "NEW", "BEST_SELLER", "LIMITED"] as const;
export type WebsiteBadgeValue = (typeof WEBSITE_BADGES)[number];
export const WEBSITE_BADGE_LABEL: Record<WebsiteBadgeValue, string> = {
  NONE: "None",
  NEW: "New",
  BEST_SELLER: "Best seller",
  LIMITED: "Limited",
};

export const MAX_WEBSITE_PHOTOS = 12;
export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 170;
export const WEBSITE_DESCRIPTION_MAX = 5000;

/** What a product / package / category form sends as `website` (absent = unchanged). */
export const websiteInputSchema = z.object({
  showOnWebsite: z.boolean().optional(),
  websiteName: z.string().trim().max(120).nullable().optional(),
  /** "" / null = made from the name (and, once published, kept as it is). */
  slug: z.string().trim().toLowerCase().max(60).nullable().optional(),
  websiteDescription: z.string().max(WEBSITE_DESCRIPTION_MAX).nullable().optional(),
  /** Products and packages: first = main. Categories use their R3-1 photo. */
  photos: z.array(z.string().trim().min(1)).max(MAX_WEBSITE_PHOTOS).optional(),
  compareAtPrice: z.number().positive().nullable().optional(),
  websiteBadge: z.enum(WEBSITE_BADGES).optional(),
  websiteFeatured: z.boolean().optional(),
  websiteSortOrder: z.number().int().min(-9999).max(9999).optional(),
  seoTitle: z.string().trim().max(SEO_TITLE_MAX).nullable().optional(),
  seoDescription: z.string().trim().max(SEO_DESCRIPTION_MAX).nullable().optional(),
  /** Packages only — the website categories (one or more when shown). */
  websiteCategoryIds: z.array(z.number().int().positive()).max(20).optional(),
  /** Packages only — show "what's inside". */
  websiteShowContents: z.boolean().optional(),
});
export type WebsiteInput = z.infer<typeof websiteInputSchema>;

/** The panel's values as the ERP reads them back (list rows / edit dialog). */
export interface WebsiteValues {
  showOnWebsite: boolean;
  websiteName: string | null;
  slug: string | null;
  slugPublished: boolean;
  websiteDescription: string | null;
  photos: string[];
  compareAtPrice: number | null;
  websiteBadge: WebsiteBadgeValue;
  websiteFeatured: boolean;
  websiteSortOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
  websiteCategoryIds: number[];
  websiteShowContents: boolean;
}

export const DEFAULT_WEBSITE_VALUES: WebsiteValues = {
  showOnWebsite: true,
  websiteName: null,
  slug: null,
  slugPublished: false,
  websiteDescription: null,
  photos: [],
  compareAtPrice: null,
  websiteBadge: "NONE",
  websiteFeatured: false,
  websiteSortOrder: 0,
  seoTitle: null,
  seoDescription: null,
  websiteCategoryIds: [],
  websiteShowContents: true,
};

// ---------- the description's tiny rich-text format ----------
//
// Paragraphs (blank line between), **bold**, and lists (lines starting with
// "- "). Stored as that plain text — never HTML — and turned into blocks here,
// so the website renders React elements and nothing typed can inject markup.

export type RichSpan = { text: string; bold: boolean };
export type RichBlock = { kind: "p"; spans: RichSpan[] } | { kind: "ul"; items: RichSpan[][] };

function spans(line: string): RichSpan[] {
  const parts = line.split("**");
  // An unmatched last ** stays literal text.
  if (parts.length % 2 === 0) parts.splice(-2, 2, `${parts[parts.length - 2]}**${parts[parts.length - 1]}`);
  return parts.map((text, i) => ({ text, bold: i % 2 === 1 })).filter((s) => s.text !== "");
}

export function parseRichText(input: string | null | undefined): RichBlock[] {
  const blocks: RichBlock[] = [];
  for (const chunk of (input ?? "").replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
    let para: string[] = [];
    let list: RichSpan[][] = [];
    const flushPara = () => {
      if (para.length) blocks.push({ kind: "p", spans: spans(para.join(" ")) });
      para = [];
    };
    const flushList = () => {
      if (list.length) blocks.push({ kind: "ul", items: list });
      list = [];
    };
    for (const line of lines) {
      const item = /^\s*[-•*]\s+(.*)$/.exec(line);
      if (item) {
        flushPara();
        list.push(spans(item[1]));
      } else {
        flushList();
        para.push(line.trim());
      }
    }
    flushPara();
    flushList();
  }
  return blocks;
}

/** The description as plain text (SEO description default, WhatsApp text). */
export function richTextPlain(input: string | null | undefined): string {
  return parseRichText(input)
    .map((b) => (b.kind === "p" ? b.spans.map((s) => s.text).join("") : b.items.map((i) => i.map((s) => s.text).join("")).join("; ")))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
