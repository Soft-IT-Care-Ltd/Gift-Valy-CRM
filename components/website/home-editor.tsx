"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import {
  homeLayoutSchema,
  newBanner,
  newSection,
  SECTION_LABEL,
  type Banner,
  type BannerImage,
  type HomeLayout,
  type HomeSection,
  type HomeSectionKind,
  type ItemRef,
} from "@/lib/home-page/layout";
import type { HomeEditorState, PickCategory, PickItem } from "@/lib/home-page/service";

// ROUND3 W-7 — the home page manager. The owner edits a DRAFT: sections
// switched on/off, moved up/down, added and removed; banners each with a
// desktop and a mobile photo, a link and optional show-from/until. "Save
// draft" changes nothing on the website; "Preview" opens the saved draft on
// the real website (a signed link, two hours); "Publish" makes it what every
// visitor sees on the very next page load. The same schema checks the draft
// here and on the server (lib/home-page/layout.ts).

const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
const SELECT = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ADDABLE: HomeSectionKind[] = ["banners", "categories", "items", "photo_box", "text", "all", "promises"];

function moved<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function MoveButtons({ index, count, onMove, onRemove, removeLabel }: { index: number; count: number; onMove: (to: number) => void; onRemove: () => void; removeLabel: string }) {
  return (
    <div className="flex items-center gap-1">
      <Button type="button" size="icon" variant="ghost" className="size-8" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label="Move up">
        <ArrowUp className="size-4" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className="size-8" disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label="Move down">
        <ArrowDown className="size-4" />
      </Button>
      <Button type="button" size="icon" variant="ghost" className="size-8 text-destructive" onClick={onRemove} aria-label={removeLabel}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

export function HomeEditor({ initial, websiteUrl }: { initial: HomeEditorState; websiteUrl: string | null }) {
  const [state, setState] = useState(initial);
  const [draft, setDraft] = useState<HomeLayout>(initial.draft);
  const [busy, setBusy] = useState<null | "save" | "publish" | "preview" | "discard">(null);
  const [adding, setAdding] = useState<HomeSectionKind>("items");
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.draft);

  const setSections = (fn: (s: HomeSection[]) => HomeSection[]) => setDraft((d) => ({ ...d, sections: fn(d.sections) }));
  const update = (i: number, patch: Partial<HomeSection>) => setSections((s) => s.map((x, j) => (j === i ? ({ ...x, ...patch } as HomeSection) : x)));

  async function call(path: string, method: "PUT" | "POST", body?: unknown): Promise<unknown> {
    const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? "Something went wrong");
    return data;
  }

  /** Save the draft when it changed; false when it can't be saved. */
  async function saveDraft(quiet = false): Promise<boolean> {
    if (!dirty) return true;
    const checked = homeLayoutSchema.safeParse(draft);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      const where = typeof issue?.path[1] === "number" ? ` (${SECTION_LABEL[draft.sections[issue.path[1]]?.kind] ?? "section"} ${issue.path[1] + 1})` : "";
      toast.error(`${issue?.message ?? "Something isn't filled in"}${where}`);
      return false;
    }
    const next = (await call("/api/website/home", "PUT", { layout: checked.data })) as HomeEditorState;
    setState(next);
    setDraft(next.draft);
    if (!quiet) toast.success("Draft saved — nothing on the website changed yet");
    return true;
  }

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<void>) {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const preview = () =>
    run("preview", async () => {
      // Opened at once (a pop-up blocker allows it), pointed at the preview once the draft is saved.
      const win = window.open("about:blank", "_blank");
      if (!(await saveDraft(true))) {
        win?.close();
        return;
      }
      const { url } = (await call("/api/website/home/preview", "POST")) as { url: string };
      if (win) win.location.href = url;
      else window.location.href = url;
    });

  const publish = () =>
    run("publish", async () => {
      if (!window.confirm("Publish this home page? Every visitor sees it on their next page load.")) return;
      if (!(await saveDraft(true))) return;
      const next = (await call("/api/website/home/publish", "POST")) as HomeEditorState;
      setState(next);
      setDraft(next.draft);
      toast.success("Published — the website shows it now");
    });

  const discard = () =>
    run("discard", async () => {
      if (!window.confirm("Throw away the draft and go back to what the website shows?")) return;
      const next = (await call("/api/website/home/discard", "POST")) as HomeEditorState;
      setState(next);
      setDraft(next.draft);
      toast.success("Draft discarded");
    });

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Website home page</h1>
          <p className="text-sm text-muted-foreground">
            Switch sections on or off, put them in order, add banners. Save a draft, preview it on the real website, then publish.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {state.publishedAt ? `Published ${formatDateTime(state.publishedAt)}` : "Not published yet — the website shows the starting layout"}
            {state.draftSavedAt ? ` · Draft saved ${formatDateTime(state.draftSavedAt)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty ? <Badge variant="outline">Unsaved</Badge> : state.unpublished ? <Badge variant="secondary">Draft not published</Badge> : <Badge variant="secondary">Live</Badge>}
          {websiteUrl ? (
            <Button variant="ghost" size="sm" asChild>
              <a href={websiteUrl} target="_blank" rel="noopener">
                Website <ExternalLink className="ml-1 size-3.5" />
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      {draft.sections.map((section, i) => (
        <SectionCard
          key={section.id}
          section={section}
          index={i}
          count={draft.sections.length}
          items={state.items}
          categories={state.categories}
          onChange={(patch) => update(i, patch)}
          onMove={(to) => setSections((s) => moved(s, i, to))}
          onRemove={() => {
            if (window.confirm(`Remove “${SECTION_LABEL[section.kind]}” from the home page? (Switching it off keeps it.)`)) setSections((s) => s.filter((_, j) => j !== i));
          }}
        />
      ))}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 pt-6">
          <Field label="Add a section">
            <select className={SELECT} value={adding} onChange={(e) => setAdding(e.target.value as HomeSectionKind)}>
              {ADDABLE.map((k) => (
                <option key={k} value={k}>
                  {SECTION_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Button type="button" variant="outline" onClick={() => setSections((s) => [...s, newSection(adding, uid(adding.replace("_", "-")))])} disabled={draft.sections.length >= 24}>
            <Plus className="mr-1 size-4" /> Add
          </Button>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-2 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-2 py-3 backdrop-blur">
        <Button variant="ghost" className="text-destructive" onClick={discard} disabled={!!busy || (!state.unpublished && !dirty)}>
          Discard changes
        </Button>
        <Button variant="outline" onClick={() => run("save", async () => void (await saveDraft()))} disabled={!!busy || !dirty}>
          {busy === "save" ? "Saving…" : "Save draft"}
        </Button>
        <Button variant="outline" onClick={preview} disabled={!!busy || !websiteUrl}>
          {busy === "preview" ? "Opening…" : "Preview"}
        </Button>
        <Button onClick={publish} disabled={!!busy || (!dirty && !state.unpublished)}>
          {busy === "publish" ? "Publishing…" : "Publish"}
        </Button>
      </div>
    </div>
  );
}

function SectionCard({
  section,
  index,
  count,
  items,
  categories,
  onChange,
  onMove,
  onRemove,
}: {
  section: HomeSection;
  index: number;
  count: number;
  items: PickItem[];
  categories: PickCategory[];
  onChange: (patch: Partial<HomeSection>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  return (
    <Card className={section.enabled ? "" : "opacity-70"}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <div className="flex items-center gap-3">
          <Switch checked={section.enabled} onCheckedChange={(v) => onChange({ enabled: v })} aria-label="Show this section" />
          <CardTitle className="text-base">
            {index + 1}. {SECTION_LABEL[section.kind]}
            {!section.enabled ? <span className="ml-2 text-xs font-normal text-muted-foreground">switched off</span> : null}
          </CardTitle>
        </div>
        <MoveButtons index={index} count={count} onMove={onMove} onRemove={onRemove} removeLabel="Remove section" />
      </CardHeader>
      <CardContent className="space-y-3">
        <SectionBody section={section} items={items} categories={categories} onChange={onChange} />
      </CardContent>
    </Card>
  );
}

function SectionBody({ section: s, items, categories, onChange }: { section: HomeSection; items: PickItem[]; categories: PickCategory[]; onChange: (patch: Partial<HomeSection>) => void }) {
  const titleField = (fallback: string) =>
    "title" in s ? (
      <Field label="Title" hint={`Empty = “${fallback}”`}>
        <Input value={s.title} maxLength={60} onChange={(e) => onChange({ title: e.target.value } as Partial<HomeSection>)} />
      </Field>
    ) : null;

  switch (s.kind) {
    case "banners":
      return <BannersEditor banners={s.items} onChange={(next) => onChange({ items: next } as Partial<HomeSection>)} />;
    case "categories":
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {titleField("Shop by category")}
            <Field label="Which categories">
              <select className={SELECT} value={s.mode} onChange={(e) => onChange({ mode: e.target.value as "FEATURED" | "HAND" } as Partial<HomeSection>)}>
                <option value="FEATURED">Marked “Featured” in the catalog (none marked = all shown)</option>
                <option value="HAND">Chosen here, in this order</option>
              </select>
            </Field>
          </div>
          {s.mode === "HAND" ? (
            <IdListPicker
              label="Categories"
              options={categories.map((c) => ({ key: String(c.id), label: c.name, warn: !c.shown }))}
              value={s.categoryIds.map(String)}
              onChange={(ids) => onChange({ categoryIds: ids.map(Number) } as Partial<HomeSection>)}
              max={24}
            />
          ) : null}
        </>
      );
    case "items":
      return (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {titleField("Featured gifts")}
            <Field label="Which gifts">
              <select className={SELECT} value={s.mode} onChange={(e) => onChange({ mode: e.target.value as "FEATURED" | "HAND" | "CATEGORY" } as Partial<HomeSection>)}>
                <option value="FEATURED">Marked “Featured” in the catalog</option>
                <option value="HAND">Chosen here, in this order</option>
                <option value="CATEGORY">From one category</option>
              </select>
            </Field>
            <Field label="How many at most">
              <Input type="number" min={2} max={24} value={s.count} onChange={(e) => onChange({ count: Math.max(2, Math.min(24, Number(e.target.value) || 2)) } as Partial<HomeSection>)} />
            </Field>
          </div>
          {s.mode === "HAND" ? (
            <IdListPicker
              label="Products and packages"
              options={items.map((it) => ({ key: `${it.kind}:${it.id}`, label: `${it.name}${it.kind === "package" ? " (package)" : ""}`, warn: !it.shown }))}
              value={s.refs.map((r) => `${r.kind}:${r.id}`)}
              onChange={(keys) => onChange({ refs: keys.map(refOf) } as Partial<HomeSection>)}
              max={24}
            />
          ) : null}
          {s.mode === "CATEGORY" ? (
            <Field label="Category" hint="Its first gifts, in the catalog's order, with a “See all” link">
              <select className={SELECT} value={s.categoryId ?? ""} onChange={(e) => onChange({ categoryId: e.target.value ? Number(e.target.value) : null } as Partial<HomeSection>)}>
                <option value="">Choose…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.shown ? "" : " — not on the website"}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </>
      );
    case "photo_box":
      return (
        <Field label="Which gift" hint="Automatic = the first gift on the website whose print kit asks for photos (the Customize Chocolate Box)">
          <select
            className={SELECT}
            value={s.ref ? `${s.ref.kind}:${s.ref.id}` : ""}
            onChange={(e) => onChange({ ref: e.target.value ? refOf(e.target.value) : null } as Partial<HomeSection>)}
          >
            <option value="">Automatic</option>
            {items.map((it) => (
              <option key={`${it.kind}:${it.id}`} value={`${it.kind}:${it.id}`}>
                {it.name}
                {it.shown ? "" : " — not on the website"}
              </option>
            ))}
          </select>
        </Field>
      );
    case "text":
      return (
        <>
          <Field label="Title">
            <Input value={s.title} maxLength={60} onChange={(e) => onChange({ title: e.target.value } as Partial<HomeSection>)} />
          </Field>
          <Field label="Text" hint="Empty lines separate paragraphs; **bold**; lines starting with “- ” make a list">
            <Textarea rows={4} maxLength={2000} value={s.body} onChange={(e) => onChange({ body: e.target.value } as Partial<HomeSection>)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Button text (optional)">
              <Input value={s.buttonLabel} maxLength={40} onChange={(e) => onChange({ buttonLabel: e.target.value } as Partial<HomeSection>)} />
            </Field>
            <Field label="Button link" hint="/c/birthday, /p/…, or https://…">
              <Input value={s.buttonLink} onChange={(e) => onChange({ buttonLink: e.target.value } as Partial<HomeSection>)} />
            </Field>
          </div>
        </>
      );
    case "all":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {titleField("All gifts")}
          <Field label="How many at most">
            <Input type="number" min={4} max={60} value={s.count} onChange={(e) => onChange({ count: Math.max(4, Math.min(60, Number(e.target.value) || 4)) } as Partial<HomeSection>)} />
          </Field>
        </div>
      );
    case "promises":
      return <p className="text-sm text-muted-foreground">Delivery anywhere in Bangladesh · We confirm every order on WhatsApp · Advance by bKash or Nagad</p>;
  }
}

const refOf = (key: string): ItemRef => {
  const [kind, id] = key.split(":");
  return { kind: kind as ItemRef["kind"], id: Number(id) };
};

/** A chosen list, in order: ▲▼✕ per row and a searchable "add" picker. */
function IdListPicker({
  label,
  options,
  value,
  onChange,
  max,
}: {
  label: string;
  options: { key: string; label: string; warn: boolean }[];
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
}) {
  const [q, setQ] = useState("");
  const byKey = useMemo(() => new Map(options.map((o) => [o.key, o])), [options]);
  const free = options.filter((o) => !value.includes(o.key) && !o.warn && o.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="grid gap-2">
      <Label className="text-xs">{label}</Label>
      {value.length === 0 ? <p className="text-sm text-muted-foreground">Nothing chosen yet.</p> : null}
      <ol className="grid gap-1">
        {value.map((key, i) => {
          const o = byKey.get(key);
          return (
            <li key={key} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm">
              <span>
                {i + 1}. {o?.label ?? "(removed)"}
                {o?.warn ? <span className="ml-2 text-xs text-amber-600">not on the website — won&apos;t show</span> : null}
              </span>
              <span className="flex items-center">
                <Button type="button" size="icon" variant="ghost" className="size-7" disabled={i === 0} onClick={() => onChange(moved(value, i, i - 1))} aria-label="Move up">
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="size-7" disabled={i === value.length - 1} onClick={() => onChange(moved(value, i, i + 1))} aria-label="Move down">
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="size-7" onClick={() => onChange(value.filter((k) => k !== key))} aria-label="Remove">
                  <X className="size-3.5" />
                </Button>
              </span>
            </li>
          );
        })}
      </ol>
      {value.length < max ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr]">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
          <select
            className={SELECT}
            value=""
            onChange={(e) => {
              if (e.target.value) onChange([...value, e.target.value]);
            }}
          >
            <option value="">{free.length ? `Add… (${free.length})` : "Nothing more to add"}</option>
            {free.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

// ---------- banners ----------

function BannersEditor({ banners, onChange }: { banners: Banner[]; onChange: (next: Banner[]) => void }) {
  const set = (i: number, patch: Partial<Banner>) => onChange(banners.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Each banner needs a desktop photo (1920 × 700) and a mobile photo (1080 × 1350). Until they arrive, a placeholder is drawn in the brand
        colours with the banner&apos;s text. Swiped sideways on a phone; turns by itself every 6 seconds.
      </p>
      {banners.map((b, i) => (
        <div key={b.id} className={`space-y-3 rounded-lg border p-3 ${b.enabled ? "" : "opacity-70"}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Switch checked={b.enabled} onCheckedChange={(v) => set(i, { enabled: v })} aria-label="Show this banner" />
              <span className="text-sm font-medium">Banner {i + 1}</span>
            </div>
            <MoveButtons
              index={i}
              count={banners.length}
              onMove={(to) => onChange(moved(banners, i, to))}
              onRemove={() => {
                if (window.confirm("Remove this banner?")) onChange(banners.filter((_, j) => j !== i));
              }}
              removeLabel="Remove banner"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="What it says" hint="Read aloud to people who can't see it; the placeholder's headline">
              <Input value={b.text} maxLength={120} onChange={(e) => set(i, { text: e.target.value })} />
            </Field>
            <Field label="Link (optional)" hint="/c/birthday, /p/…, #all, or https://…">
              <Input value={b.link} onChange={(e) => set(i, { link: e.target.value })} />
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={b.placeholder} onCheckedChange={(v) => set(i, { placeholder: v })} id={`ph-${b.id}`} />
            <Label htmlFor={`ph-${b.id}`} className="text-sm">
              Use the placeholder (drawn by the website with this text)
            </Label>
          </div>
          {b.placeholder ? (
            <Field label="Second line (placeholder only)">
              <Input value={b.subtext} maxLength={160} onChange={(e) => set(i, { subtext: e.target.value })} />
            </Field>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr]">
            <BannerPhoto kind="desktop" image={b.desktop} onChange={(img) => set(i, { desktop: img })} />
            <BannerPhoto kind="mobile" image={b.mobile} onChange={(img) => set(i, { mobile: img })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Show from (optional, Dhaka time)">
              <Input type="datetime-local" value={b.startsAt ?? ""} onChange={(e) => set(i, { startsAt: e.target.value || null })} />
            </Field>
            <Field label="Show until (optional, Dhaka time)">
              <Input type="datetime-local" value={b.endsAt ?? ""} onChange={(e) => set(i, { endsAt: e.target.value || null })} />
            </Field>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" disabled={banners.length >= 8} onClick={() => onChange([...banners, newBanner(uid("banner"))])}>
        <Plus className="mr-1 size-4" /> Add banner
      </Button>
    </div>
  );
}

function BannerPhoto({ kind, image, onChange }: { kind: "desktop" | "mobile"; image: BannerImage | null; onChange: (img: BannerImage | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", kind);
      const res = await fetch("/api/website/banner", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      onChange(body.image as BannerImage);
      toast.success(`${kind === "desktop" ? "Desktop" : "Mobile"} photo uploaded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{kind === "desktop" ? "Desktop photo (1920 × 700)" : "Mobile photo (1080 × 1350)"}</Label>
      <div className={`relative grid place-items-center overflow-hidden rounded-md border bg-muted ${kind === "desktop" ? "aspect-[1920/700]" : "aspect-[1080/1350] max-h-56"}`}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/uploads/${image.file}`} alt="" className="size-full object-cover" />
        ) : (
          <span className="text-xs text-muted-foreground">No photo</span>
        )}
      </div>
      <div className="flex gap-2">
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => input.current?.click()}>
          <ImagePlus className="mr-1 size-4" /> {uploading ? "Uploading…" : image ? "Replace" : "Upload"}
        </Button>
        {image ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            Remove
          </Button>
        ) : null}
      </div>
      {image ? <p className="text-xs text-muted-foreground">{`${image.width} × ${image.height}`}</p> : null}
    </div>
  );
}
