import { z } from "zod";

// ROUND3 W-7 — the website's home page as a list of sections the owner
// switches on/off, puts in order, adds and removes (website.home: Admin,
// Manager). Saved as a DRAFT; the website shows only what was PUBLISHED
// (home_page.published). Client- and server-safe: the editor and the API
// check with this one schema.

/** The one home_page row. */
export const HOME_PAGE_ID = "home";

const sectionId = z.string().regex(/^[a-z0-9-]{1,40}$/);
const dhakaLocal = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use a date and time");
const title = z.string().trim().max(60, "At most 60 characters");
const id = z.number().int().positive();

/** A link stays on the website ("/c/sarees", "/p/…", "/search?q=…", "#all") or goes to an https address; anything else is refused. */
export const isSafeLink = (link: string) =>
  link === "" ||
  /^#[a-z0-9-]{1,40}$/.test(link) ||
  (/^\/(?!\/)[\w\-./?=&%+#~]*$/.test(link) && !link.includes("..")) ||
  /^https:\/\/[\w.-]+(\/[\w\-./?=&%+#~]*)?$/.test(link);
const link = z.string().trim().max(300).refine(isSafeLink, "A link must start with / (a page on this website) or https://");

/** A banner photo as uploaded (POST /api/website/banner): UPLOAD_DIR/banner-<uuid>.webp and its size. */
export const BANNER_FILE = /^banner-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
const bannerImage = z.object({
  file: z.string().regex(BANNER_FILE),
  width: z.number().int().min(1).max(4000),
  height: z.number().int().min(1).max(4000),
});
export type BannerImage = z.infer<typeof bannerImage>;

export const bannerSchema = z
  .object({
    id: sectionId,
    enabled: z.boolean(),
    /** What the banner says — read aloud for people who can't see it, and the placeholder's headline. */
    text: z.string().trim().min(1, "Write what the banner says").max(120, "At most 120 characters"),
    /** The placeholder's second line. */
    subtext: z.string().trim().max(160, "At most 160 characters"),
    link,
    /** Until the real photos arrive the website draws the banner itself, in the brand colours, with its text. */
    placeholder: z.boolean(),
    desktop: bannerImage.nullable(),
    mobile: bannerImage.nullable(),
    /** Optional show-from / show-until, Dhaka time. */
    startsAt: dhakaLocal.nullable(),
    endsAt: dhakaLocal.nullable(),
  })
  .superRefine((b, ctx) => {
    if (!b.placeholder && (!b.desktop || !b.mobile)) {
      ctx.addIssue({ code: "custom", path: ["mobile"], message: "A banner needs a desktop photo and a mobile photo (or use the placeholder)" });
    }
    if (b.startsAt && b.endsAt && b.endsAt <= b.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "A banner must end after it starts" });
  });
export type Banner = z.infer<typeof bannerSchema>;

export const itemRef = z.object({ kind: z.enum(["product", "package"]), id });
export type ItemRef = z.infer<typeof itemRef>;

const base = { id: sectionId, enabled: z.boolean() };

export const sectionSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("banners"), items: z.array(bannerSchema).max(8, "At most 8 banners") }),
  /** Category tiles: the ones marked Featured in the catalog (none featured = every shown one), or chosen by hand. */
  z.object({ ...base, kind: z.literal("categories"), title, mode: z.enum(["FEATURED", "HAND"]), categoryIds: z.array(id).max(24) }),
  /** Products and packages: Featured in the catalog, chosen by hand (in order), or from one category. */
  z.object({
    ...base,
    kind: z.literal("items"),
    title,
    mode: z.enum(["FEATURED", "HAND", "CATEGORY"]),
    refs: z.array(itemRef).max(24),
    categoryId: id.nullable(),
    count: z.number().int().min(2).max(24),
  }),
  /** The Customize Chocolate Box highlight: a chosen item, or the first shown item whose print kit asks for photos. */
  z.object({ ...base, kind: z.literal("photo_box"), ref: itemRef.nullable() }),
  /** A text block: a title, a few lines (**bold**, "- " lists) and an optional button. */
  z.object({
    ...base,
    kind: z.literal("text"),
    title,
    body: z.string().trim().max(2000, "At most 2,000 characters"),
    buttonLabel: z.string().trim().max(40, "At most 40 characters"),
    buttonLink: link,
  }),
  z.object({ ...base, kind: z.literal("all"), title, count: z.number().int().min(4).max(60) }),
  /** Delivery anywhere in Bangladesh · we confirm on WhatsApp · advance by bKash or Nagad. */
  z.object({ ...base, kind: z.literal("promises") }),
]);
export type HomeSection = z.infer<typeof sectionSchema>;
export type HomeSectionKind = HomeSection["kind"];

export const homeLayoutSchema = z
  .object({ version: z.literal(1), sections: z.array(sectionSchema).max(24) })
  .superRefine((l, ctx) => {
    if (new Set(l.sections.map((s) => s.id)).size !== l.sections.length) ctx.addIssue({ code: "custom", path: ["sections"], message: "Two sections share an id" });
    const bannerIds = l.sections.flatMap((s) => (s.kind === "banners" ? s.items.map((b) => b.id) : []));
    if (new Set(bannerIds).size !== bannerIds.length) ctx.addIssue({ code: "custom", path: ["sections"], message: "Two banners share an id" });
    l.sections.forEach((s, i) => {
      if (s.kind === "text" && s.buttonLabel && !s.buttonLink) ctx.addIssue({ code: "custom", path: ["sections", i, "buttonLink"], message: "The button needs a link" });
      if (s.kind === "items" && s.mode === "CATEGORY" && !s.categoryId) ctx.addIssue({ code: "custom", path: ["sections", i, "categoryId"], message: "Choose the category" });
    });
  });
export type HomeLayout = z.infer<typeof homeLayoutSchema>;

export const SECTION_LABEL: Record<HomeSectionKind, string> = {
  banners: "Banner slider",
  categories: "Featured categories",
  items: "Featured products / packages",
  photo_box: "Customize Chocolate Box highlight",
  text: "Text block",
  all: "All gifts",
  promises: "Promises strip",
};

/** Every banner photo a layout uses. */
export function layoutBannerFiles(layout: HomeLayout): string[] {
  const files = layout.sections.flatMap((s) => (s.kind === "banners" ? s.items.flatMap((b) => [b.desktop?.file, b.mobile?.file]) : []));
  return [...new Set(files.filter((f): f is string => !!f))];
}

export const layoutItemRefs = (layout: HomeLayout): ItemRef[] =>
  layout.sections.flatMap((s) => (s.kind === "items" ? s.refs : s.kind === "photo_box" && s.ref ? [s.ref] : []));
export const layoutCategoryIds = (layout: HomeLayout): number[] => [
  ...new Set(layout.sections.flatMap((s) => (s.kind === "categories" ? s.categoryIds : s.kind === "items" && s.categoryId ? [s.categoryId] : []))),
];

/** A new section of a kind, with sensible defaults. */
export function newSection(kind: HomeSectionKind, sectionId: string): HomeSection {
  switch (kind) {
    case "banners":
      return { id: sectionId, kind, enabled: true, items: [] };
    case "categories":
      return { id: sectionId, kind, enabled: true, title: "Shop by category", mode: "FEATURED", categoryIds: [] };
    case "items":
      return { id: sectionId, kind, enabled: true, title: "Featured gifts", mode: "FEATURED", refs: [], categoryId: null, count: 12 };
    case "photo_box":
      return { id: sectionId, kind, enabled: true, ref: null };
    case "text":
      return { id: sectionId, kind, enabled: true, title: "", body: "", buttonLabel: "", buttonLink: "" };
    case "all":
      return { id: sectionId, kind, enabled: true, title: "All gifts", count: 24 };
    case "promises":
      return { id: sectionId, kind, enabled: true };
  }
}

export function newBanner(bannerId: string): Banner {
  return { id: bannerId, enabled: true, text: "", subtext: "", link: "", placeholder: true, desktop: null, mobile: null, startsAt: null, endsAt: null };
}

/**
 * The layout the website shows until the first publish: the W-4 home page —
 * the brand banner (a placeholder until the owner's photos arrive), the
 * featured categories, featured gifts, the photo-box highlight, all gifts,
 * the promises.
 */
export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  version: 1,
  sections: [
    {
      id: "banners",
      kind: "banners",
      enabled: true,
      items: [
        {
          id: "welcome",
          enabled: true,
          text: "Send love home",
          subtext: "Gift boxes, sarees, cakes, flowers and more — delivered to your family anywhere in Bangladesh.",
          link: "#all",
          placeholder: true,
          desktop: null,
          mobile: null,
          startsAt: null,
          endsAt: null,
        },
      ],
    },
    { id: "categories", kind: "categories", enabled: true, title: "Shop by category", mode: "FEATURED", categoryIds: [] },
    { id: "featured", kind: "items", enabled: true, title: "Featured gifts", mode: "FEATURED", refs: [], categoryId: null, count: 12 },
    { id: "photo-box", kind: "photo_box", enabled: true, ref: null },
    { id: "all", kind: "all", enabled: true, title: "All gifts", count: 24 },
    { id: "promises", kind: "promises", enabled: true },
  ],
};

/** A stored layout, or null when it doesn't parse (the caller falls back). */
export function parseHomeLayout(raw: unknown): HomeLayout | null {
  const p = homeLayoutSchema.safeParse(raw);
  return p.success ? p.data : null;
}

/** "2026-12-01T10:00" (Dhaka) → the moment, UTC. */
export function dhakaLocalToUtc(local: string): Date {
  return new Date(`${local}:00+06:00`);
}
