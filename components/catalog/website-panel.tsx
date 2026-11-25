"use client";

import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Bold, Globe, List, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_WEBSITE_VALUES,
  MAX_WEBSITE_PHOTOS,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  WEBSITE_BADGES,
  WEBSITE_BADGE_LABEL,
  richTextPlain,
  type WebsiteBadgeValue,
  type WebsiteInput,
  type WebsiteValues,
} from "@/lib/catalog-website-shape";
import { productSlugBase, slugify } from "@/lib/storefront/slug";

// ROUND3 W-2 — the Website panel, the same on the product, package and
// category forms, Create and Edit alike (each form is one dialog). Its values
// go out with the form's own save, as `website`; lib/catalog-website.ts
// applies them and writes the "catalog.website" audit row.

export type WebsiteKind = "product" | "package" | "category";

export function useWebsiteForm() {
  const [v, setV] = useState({
    showOnWebsite: true,
    websiteName: "",
    slug: "",
    slugPublished: false,
    savedSlug: "",
    websiteDescription: "",
    photos: [] as string[],
    compareAtPrice: "",
    websiteBadge: "NONE" as WebsiteBadgeValue,
    websiteFeatured: false,
    websiteSortOrder: "0",
    seoTitle: "",
    seoDescription: "",
    websiteCategoryIds: [] as number[],
    websiteShowContents: true,
  });
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => setV((prev) => ({ ...prev, [key]: value }));

  /** Fill from a saved row (Edit) or the defaults (Create; `photos` seeds the first photo). */
  function load(values: WebsiteValues | null | undefined) {
    const w = values ?? DEFAULT_WEBSITE_VALUES;
    setV({
      showOnWebsite: w.showOnWebsite,
      websiteName: w.websiteName ?? "",
      // A published address is fixed and shown as it is; an unpublished one
      // follows the name unless typed here.
      slug: w.slugPublished ? w.slug ?? "" : "",
      slugPublished: w.slugPublished,
      savedSlug: w.slug ?? "",
      websiteDescription: w.websiteDescription ?? "",
      photos: [...w.photos],
      compareAtPrice: w.compareAtPrice == null ? "" : String(w.compareAtPrice),
      websiteBadge: w.websiteBadge,
      websiteFeatured: w.websiteFeatured,
      websiteSortOrder: String(w.websiteSortOrder),
      seoTitle: w.seoTitle ?? "",
      seoDescription: w.seoDescription ?? "",
      websiteCategoryIds: [...w.websiteCategoryIds],
      websiteShowContents: w.websiteShowContents,
    });
  }

  /** What the form posts as `website` for this kind. */
  function payload(kind: WebsiteKind): WebsiteInput {
    const common: WebsiteInput = {
      showOnWebsite: v.showOnWebsite,
      websiteName: v.websiteName.trim() || null,
      slug: v.slug.trim() || null,
      websiteDescription: v.websiteDescription.trim() || null,
      websiteFeatured: v.websiteFeatured,
      websiteSortOrder: Math.trunc(Number(v.websiteSortOrder) || 0),
      seoTitle: v.seoTitle.trim() || null,
      seoDescription: v.seoDescription.trim() || null,
    };
    if (kind === "category") return common;
    const item: WebsiteInput = {
      ...common,
      photos: v.photos,
      compareAtPrice: v.compareAtPrice.trim() === "" ? null : Number(v.compareAtPrice),
      websiteBadge: v.websiteBadge,
    };
    if (kind === "product") return item;
    return { ...item, websiteCategoryIds: v.websiteCategoryIds, websiteShowContents: v.websiteShowContents };
  }

  /** The form's ERP photo (main = first) — the products/packages photoUrl. */
  const mainPhoto = v.photos[0] ?? null;

  return { v, set, load, payload, mainPhoto };
}

export type WebsiteForm = ReturnType<typeof useWebsiteForm>;

export function WebsitePanel({
  kind,
  form,
  itemName,
  code,
  price,
  notEligible,
  isActive = true,
  productCategoryName,
  categories,
  photoSlot,
}: {
  kind: WebsiteKind;
  form: WebsiteForm;
  /** The ERP name typed on the form (website name / SEO title default). */
  itemName: string;
  /** SKU / package code — the address fallback when a name gives nothing Latin. */
  code?: string | null;
  /** Selling price (compare-at must be above it). */
  price?: number | null;
  /** Why it can't be shown (COMPONENT product) — disables the switch. */
  notEligible?: string | null;
  isActive?: boolean;
  /** Products: their (one) category, shown read-only. */
  productCategoryName?: string | null;
  /** Packages: every category to choose from. */
  categories?: { id: number; name: string }[];
  /** Categories: the R3-1 photo field, placed in the panel. */
  photoSlot?: ReactNode;
}) {
  const { v, set } = form;
  const displayName = v.websiteName.trim() || itemName.trim();
  const suggested =
    kind === "category" ? slugify(displayName) || "category" : displayName ? productSlugBase(displayName, code ?? "item") : "";
  const prefix = kind === "category" ? "/c/" : "/p/";
  const slugChanged = v.slugPublished && v.slug.trim() !== "" && v.slug.trim() !== v.savedSlug;
  const compare = v.compareAtPrice.trim() === "" ? null : Number(v.compareAtPrice);
  const compareBad = compare != null && price != null && !(compare > price);
  const showing = !notEligible && v.showOnWebsite;

  return (
    <div className="grid gap-3 rounded-md border border-primary/30 bg-primary/[0.03] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="flex items-center gap-1.5">
            <Globe className="size-4" /> Website
          </Label>
          <p className="text-xs text-muted-foreground">
            {notEligible
              ? notEligible
              : !isActive
                ? "Inactive items are never shown, whatever this switch says."
                : "Show this on giftvaly.com — every website setting for it is here."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Show on website</span>
          <Switch
            checked={showing}
            disabled={Boolean(notEligible)}
            onCheckedChange={(c) => set("showOnWebsite", c)}
            aria-label="Show on website"
          />
        </div>
      </div>

      {notEligible && kind !== "category" && (
        // Not sold on the website, but the photo is the ERP's photo too.
        <PhotosField photos={v.photos} onChange={(p) => set("photos", p)} />
      )}

      {!notEligible && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Website name</Label>
              <Input
                value={v.websiteName}
                placeholder={itemName || "Defaults to the name"}
                onChange={(e) => set("websiteName", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Address</Label>
              <div className="flex items-center rounded-md border bg-background pl-2 text-sm">
                <span className="text-muted-foreground">{prefix}</span>
                <input
                  className="h-9 min-w-0 flex-1 bg-transparent px-1 outline-none"
                  value={v.slug}
                  placeholder={v.slugPublished ? v.savedSlug : suggested || "made from the name"}
                  onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {slugChanged
                  ? `The old address ${prefix}${v.savedSlug} will keep working (redirect).`
                  : v.slugPublished
                    ? "Published — fixed. Changing it keeps the old address as a redirect."
                    : "Made from the name until first shown; a–z, 0–9, hyphens."}
              </p>
            </div>
          </div>

          <DescriptionField value={v.websiteDescription} onChange={(t) => set("websiteDescription", t)} />

          {kind === "category" ? (
            photoSlot
          ) : (
            <PhotosField photos={v.photos} onChange={(p) => set("photos", p)} />
          )}

          {kind === "product" && (
            <p className="text-xs text-muted-foreground">
              Website category: <span className="font-medium text-foreground">{productCategoryName || "—"}</span> (the product&apos;s category)
            </p>
          )}
          {kind === "package" && categories && (
            <div className="grid gap-1.5">
              <Label className="text-xs">Website categories (one or more)</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border bg-background p-2">
                {categories.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={v.websiteCategoryIds.includes(c.id)}
                      onCheckedChange={(on) =>
                        set(
                          "websiteCategoryIds",
                          on ? [...v.websiteCategoryIds, c.id] : v.websiteCategoryIds.filter((id) => id !== c.id)
                        )
                      }
                    />
                    {c.name}
                  </label>
                ))}
                {categories.length === 0 && <span className="text-xs text-muted-foreground">No categories yet.</span>}
              </div>
              {showing && v.websiteCategoryIds.length === 0 && (
                <p className="text-[11px] text-amber-700">No category picked: the package is on the website but listed under no category.</p>
              )}
            </div>
          )}

          {kind !== "category" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Compare-at price (৳, optional)</Label>
                <Input
                  type="number"
                  min="0"
                  value={v.compareAtPrice}
                  placeholder="was ৳…"
                  onChange={(e) => set("compareAtPrice", e.target.value)}
                />
                {compareBad && <p className="text-[11px] text-destructive">Must be above the price (৳{price}).</p>}
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Badge</Label>
                <Select value={v.websiteBadge} onValueChange={(b) => set("websiteBadge", b as WebsiteBadgeValue)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEBSITE_BADGES.map((b) => (
                      <SelectItem key={b} value={b}>
                        {WEBSITE_BADGE_LABEL[b]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm">
              Featured on home page
              <Switch checked={v.websiteFeatured} onCheckedChange={(c) => set("websiteFeatured", c)} />
            </label>
            <div className="grid gap-1">
              <Label className="text-xs">Sort order (lower first)</Label>
              <Input type="number" value={v.websiteSortOrder} onChange={(e) => set("websiteSortOrder", e.target.value)} />
            </div>
          </div>

          {kind === "package" && (
            <label className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm">
              <span>
                Show &quot;what&apos;s inside&quot;
                <span className="block text-[11px] text-muted-foreground">The contents list — names and quantities only.</span>
              </span>
              <Switch checked={v.websiteShowContents} onCheckedChange={(c) => set("websiteShowContents", c)} />
            </label>
          )}

          <div className="grid gap-1.5">
            <Label className="text-xs">
              SEO title <span className="text-muted-foreground">({v.seoTitle.length}/{SEO_TITLE_MAX})</span>
            </Label>
            <Input
              value={v.seoTitle}
              maxLength={SEO_TITLE_MAX}
              placeholder={displayName || "Defaults to the name"}
              onChange={(e) => set("seoTitle", e.target.value)}
            />
            <Label className="text-xs">
              SEO description <span className="text-muted-foreground">({v.seoDescription.length}/{SEO_DESCRIPTION_MAX})</span>
            </Label>
            <Textarea
              rows={2}
              value={v.seoDescription}
              maxLength={SEO_DESCRIPTION_MAX}
              placeholder={richTextPlain(v.websiteDescription).slice(0, SEO_DESCRIPTION_MAX) || "Defaults to the description"}
              onChange={(e) => set("seoDescription", e.target.value)}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** Paragraphs, **bold** and "- " lists — stored as that text, never HTML. */
function DescriptionField({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function bold() {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const picked = value.slice(a, b) || "bold text";
    onChange(`${value.slice(0, a)}**${picked}**${value.slice(b)}`);
  }

  function list() {
    const el = ref.current;
    if (!el) return;
    const a = value.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const endAt = value.indexOf("\n", el.selectionEnd);
    const b = endAt === -1 ? value.length : endAt;
    const lines = value.slice(a, b).split("\n").map((l) => (/^\s*- /.test(l) ? l : `- ${l}`));
    onChange(`${value.slice(0, a)}${lines.join("\n")}${value.slice(b)}`);
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Website description</Label>
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="icon" className="size-7" onClick={bold} title="Bold">
            <Bold className="size-3.5" />
          </Button>
          <Button type="button" variant="outline" size="icon" className="size-7" onClick={list} title="List">
            <List className="size-3.5" />
          </Button>
        </div>
      </div>
      <Textarea
        ref={ref}
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={"A paragraph about it.\n\n- One point\n- **Bold** words like this"}
      />
      <p className="text-[11px] text-muted-foreground">Blank line = new paragraph · **bold** · lines starting with “- ” make a list.</p>
    </div>
  );
}

/** Several photos: upload, drag (or ←/→) to order, first = main. */
function PhotosField({ photos, onChange }: { photos: string[]; onChange: (photos: string[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    const added: string[] = [];
    for (const file of Array.from(files).slice(0, MAX_WEBSITE_PHOTOS - photos.length)) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? `Upload failed: ${file.name}`);
        continue;
      }
      added.push((await res.json()).url);
    }
    setUploading(false);
    if (added.length) onChange([...photos, ...added]);
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= photos.length || from === to) return;
    const next = [...photos];
    const [p] = next.splice(from, 1);
    next.splice(to, 0, p);
    onChange(next);
  };

  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">Photos — first is the main photo (drag to reorder)</Label>
      <div className="flex flex-wrap gap-2">
        {photos.map((url, i) => (
          <div
            key={url}
            draggable
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragFrom != null) move(dragFrom, i);
              setDragFrom(null);
            }}
            className="group relative size-20 cursor-grab overflow-hidden rounded-md border bg-background"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Photo ${i + 1}`} className="size-full object-cover" />
            {i === 0 && <Badge className="absolute left-1 top-1 px-1 py-0 text-[10px]">Main</Badge>}
            <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
              <button type="button" className="p-1 text-white" onClick={() => move(i, i - 1)} aria-label="Move left">
                <ArrowLeft className="size-3.5" />
              </button>
              <button type="button" className="p-1 text-white" onClick={() => onChange(photos.filter((p) => p !== url))} aria-label="Remove photo">
                <X className="size-3.5" />
              </button>
              <button type="button" className="p-1 text-white" onClick={() => move(i, i + 1)} aria-label="Move right">
                <ArrowRight className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
        {photos.length < MAX_WEBSITE_PHOTOS && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex size-20 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted"
          >
            {uploading ? "Uploading…" : "+ Add"}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Square or 4:5, at least 1080 px. No photo = a Gift Valy placeholder on the website.
      </p>
    </div>
  );
}
