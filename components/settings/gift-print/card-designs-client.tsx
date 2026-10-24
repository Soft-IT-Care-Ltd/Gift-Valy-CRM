"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CardDesignRow } from "@/lib/card-library";
import type { PrintSize } from "@/lib/print-layouts";

// PHOTO_PRINT.md PP-3 — card designs. Each design is a text-free background
// for one card size plus where/how the message is written. The text area is
// drawn on the card (drag to move, corner to resize) and stored in % of the
// card; the preview is rendered by the SAME server renderer as the print PDF.

type CardSlot = "CARD_1" | "CARD_2";
type Box = { x: number; y: number; w: number; h: number };
type Align = "LEFT" | "CENTER" | "RIGHT";

interface FontOption {
  fontPath: string;
  name: string;
}

interface Draft {
  name: string;
  slot: CardSlot;
  backgroundPath: string | null;
  textBox: Box;
  textColor: string;
  align: Align;
  fontPath: string | null;
  maxFontPt: string;
  minFontPt: string;
  isActive: boolean;
}

const DEFAULT_FONT = "__default";
const SLOT_NAMES: Record<CardSlot, string> = { CARD_1: "Card 1 (large)", CARD_2: "Card 2 (small)" };

const blankDraft = (slot: CardSlot = "CARD_1"): Draft => ({
  name: "",
  slot,
  backgroundPath: null,
  textBox: { x: 12, y: 6, w: 76, h: 50 },
  textColor: "#be185d",
  align: "CENTER",
  fontPath: null,
  maxFontPt: "16",
  minFontPt: "9",
  isActive: true,
});

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The card with its text area — drag inside to move, the corner to resize. */
function TextBoxEditor({
  background,
  aspect,
  box,
  onChange,
}: {
  background: string | null;
  aspect: number;
  box: Box;
  onChange: (b: Box) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "move" | "resize"; sx: number; sy: number; start: Box } | null>(null);

  function onPointerDown(e: React.PointerEvent, mode: "move" | "resize") {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: box };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const rect = el.getBoundingClientRect();
    const dx = ((e.clientX - d.sx) / rect.width) * 100;
    const dy = ((e.clientY - d.sy) / rect.height) * 100;
    if (d.mode === "move") {
      onChange({
        ...d.start,
        x: r1(Math.min(100 - d.start.w, Math.max(0, d.start.x + dx))),
        y: r1(Math.min(100 - d.start.h, Math.max(0, d.start.y + dy))),
      });
    } else {
      onChange({
        ...d.start,
        w: r1(Math.min(100 - d.start.x, Math.max(5, d.start.w + dx))),
        h: r1(Math.min(100 - d.start.y, Math.max(5, d.start.h + dy))),
      });
    }
  }
  const end = () => (drag.current = null);

  return (
    <div
      ref={ref}
      className="relative w-full touch-none select-none overflow-hidden rounded-md border bg-white"
      style={{ aspectRatio: String(aspect) }}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {background ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={background} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
          No background yet
        </div>
      )}
      <div
        className="absolute cursor-move border-2 border-dashed border-primary bg-primary/10"
        style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` }}
        onPointerDown={(e) => onPointerDown(e, "move")}
        aria-label="Text area"
      >
        <span className="absolute left-1 top-0.5 rounded bg-primary px-1 text-[10px] font-medium text-primary-foreground">
          Text area
        </span>
        <span
          className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-primary shadow"
          onPointerDown={(e) => onPointerDown(e, "resize")}
          aria-label="Resize text area"
        />
      </div>
    </div>
  );
}

export function CardDesignsClient({
  designs,
  sizes,
  fonts: initialFonts,
  sampleText,
}: {
  designs: CardDesignRow[];
  sizes: Record<CardSlot, PrintSize>;
  fonts: FontOption[];
  sampleText: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CardDesignRow | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [pendingBg, setPendingBg] = useState<File | null>(null);
  const [pendingBgUrl, setPendingBgUrl] = useState<string | null>(null);
  const [fonts, setFonts] = useState(initialFonts);
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState(sampleText);
  const [toName, setToName] = useState("নুসরাত");
  const [fromName, setFromName] = useState("রিফাত");
  const [preview, setPreview] = useState<{ url: string; pt: string; fits: boolean } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const bgInput = useRef<HTMLInputElement>(null);
  const fontInput = useRef<HTMLInputElement>(null);

  function openNew(slot: CardSlot) {
    setEditing(null);
    setDraft(blankDraft(slot));
    setPendingBg(null);
    setPendingBgUrl(null);
    setPreview(null);
    setOpen(true);
  }

  function openEdit(d: CardDesignRow) {
    setEditing(d);
    setDraft({
      name: d.name,
      slot: d.slot,
      backgroundPath: d.backgroundPath,
      textBox: d.textBox,
      textColor: d.textColor,
      align: d.align,
      fontPath: d.fontPath,
      maxFontPt: String(d.maxFontPt),
      minFontPt: String(d.minFontPt),
      isActive: d.isActive,
    });
    setPendingBg(null);
    setPendingBgUrl(null);
    setPreview(null);
    setOpen(true);
  }

  const payload = {
    name: draft.name,
    slot: draft.slot,
    textBox: draft.textBox,
    textColor: draft.textColor,
    align: draft.align,
    fontPath: draft.fontPath,
    maxFontPt: Number(draft.maxFontPt) || 16,
    minFontPt: Number(draft.minFontPt) || 9,
    isActive: draft.isActive,
  };

  // Live preview of the saved background + current (unsaved) text settings,
  // debounced. A newly picked background shows after Save (it is cropped on
  // the server).
  const previewKey = open ? JSON.stringify([payload, draft.backgroundPath, sample, toName, fromName]) : "";
  useEffect(() => {
    if (!previewKey) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setPreviewing(true);
      try {
        const res = await fetch("/api/print/card-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            slot: payload.slot,
            design: { ...payload, backgroundPath: draft.backgroundPath },
            text: sample,
            to: toName,
            from: fromName,
            width: 640,
          }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Preview failed");
        const blob = await res.blob();
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return {
            url: URL.createObjectURL(blob),
            pt: res.headers.get("X-Card-Font-Pt") ?? "",
            fits: res.headers.get("X-Card-Fits") === "1",
          };
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setPreview(null);
      } finally {
        setPreviewing(false);
      }
    }, 500);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  async function uploadBackground(id: number, file: File) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/print/card-designs/${id}/background`, { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Background upload failed");
    return data as CardDesignRow;
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(
        editing ? `/api/print/card-designs/${editing.id}` : "/api/print/card-designs",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      let saved = data as CardDesignRow;
      if (pendingBg) saved = await uploadBackground(saved.id, pendingBg);
      toast.success(editing ? "Design updated" : "Design added");
      // Stay open on the saved design so the uploaded background shows in the preview.
      setEditing(saved);
      setDraft((d) => ({ ...d, backgroundPath: saved.backgroundPath }));
      setPendingBg(null);
      setPendingBgUrl(null);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFont(file: File) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/print/fonts", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Font upload failed");
      return;
    }
    setFonts((f) => [...f, { fontPath: data.fontPath, name: data.name }]);
    setDraft((d) => ({ ...d, fontPath: data.fontPath }));
    if (!data.bangla) toast.warning(`"${data.name}" has no Bangla letters — use it for English messages only.`);
    else toast.success(`Font "${data.name}" added`);
  }

  const size = sizes[draft.slot];
  const shownBg = pendingBgUrl ?? draft.backgroundPath;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Upload each card background <strong>without any text</strong> — the message is written on
        it at print time. The background is cropped to the card&apos;s exact size.
      </p>
      {(["CARD_1", "CARD_2"] as CardSlot[]).map((slot) => {
        const list = designs.filter((d) => d.slot === slot);
        return (
          <section key={slot} className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {SLOT_NAMES[slot]}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  {sizes[slot].w} × {sizes[slot].h} mm
                </span>
              </h2>
              <Button size="sm" variant="outline" onClick={() => openNew(slot)}>
                Add design
              </Button>
            </div>
            {list.length === 0 ? (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No designs for {SLOT_NAMES[slot]} yet.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {list.map((d) => (
                  <Card key={d.id} className={d.isActive ? "" : "opacity-60"}>
                    <CardContent className="space-y-2 p-3">
                      <div
                        className="relative overflow-hidden rounded border bg-white"
                        style={{ aspectRatio: String(sizes[slot].w / sizes[slot].h) }}
                      >
                        {d.backgroundPath ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={d.backgroundPath} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="grid h-full place-items-center text-xs text-muted-foreground">
                            No background
                          </div>
                        )}
                        <div
                          className="absolute border border-dashed border-primary/70"
                          style={{
                            left: `${d.textBox.x}%`,
                            top: `${d.textBox.y}%`,
                            width: `${d.textBox.w}%`,
                            height: `${d.textBox.h}%`,
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{d.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{d.fontName}</p>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(d)}>
                          Edit
                        </Button>
                      </div>
                      {!d.isActive && <Badge variant="outline">Inactive</Badge>}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        );
      })}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit design — ${editing.name}` : "Add card design"}</DialogTitle>
            <DialogDescription>
              Drag the text area on the card; drag its corner to resize. The preview is exactly
              what prints.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label htmlFor="d-name">Name</Label>
                  <Input
                    id="d-name"
                    value={draft.name}
                    placeholder="Pink hearts"
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label>Card</Label>
                  <Select
                    value={draft.slot}
                    onValueChange={(v) => setDraft({ ...draft, slot: v as CardSlot })}
                    disabled={!!editing}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CARD_1">{SLOT_NAMES.CARD_1}</SelectItem>
                      <SelectItem value="CARD_2">{SLOT_NAMES.CARD_2}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <TextBoxEditor
                background={shownBg}
                aspect={size.w / size.h}
                box={draft.textBox}
                onChange={(textBox) => setDraft({ ...draft, textBox })}
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={bgInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    setPendingBg(f);
                    setPendingBgUrl(URL.createObjectURL(f));
                  }}
                />
                <Button type="button" size="sm" variant="outline" onClick={() => bgInput.current?.click()}>
                  {shownBg ? "Replace background" : "Upload background"}
                </Button>
                {pendingBg && (
                  <span className="text-xs text-amber-700 dark:text-amber-400">
                    New background — saved and cropped when you press Save.
                  </span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {(["x", "y", "w", "h"] as const).map((k) => (
                  <div key={k} className="grid gap-1">
                    <Label className="text-xs">
                      {{ x: "Left %", y: "Top %", w: "Width %", h: "Height %" }[k]}
                    </Label>
                    <Input
                      type="number"
                      step="0.5"
                      value={draft.textBox[k]}
                      onChange={(e) =>
                        setDraft({ ...draft, textBox: { ...draft.textBox, [k]: Number(e.target.value) || 0 } })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="d-color">Text colour</Label>
                  <div className="flex gap-2">
                    <input
                      id="d-color"
                      type="color"
                      value={/^#[0-9a-f]{6}$/i.test(draft.textColor) ? draft.textColor : "#be185d"}
                      onChange={(e) => setDraft({ ...draft, textColor: e.target.value })}
                      className="h-9 w-12 cursor-pointer rounded border bg-transparent p-1"
                    />
                    <Input
                      aria-label="Text colour (hex)"
                      value={draft.textColor}
                      onChange={(e) => setDraft({ ...draft, textColor: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-1">
                  <Label>Alignment</Label>
                  <Select value={draft.align} onValueChange={(v) => setDraft({ ...draft, align: v as Align })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CENTER">Centre</SelectItem>
                      <SelectItem value="LEFT">Left</SelectItem>
                      <SelectItem value="RIGHT">Right</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 grid gap-1">
                  <Label>Font</Label>
                  <div className="flex gap-2">
                    <Select
                      value={draft.fontPath ?? DEFAULT_FONT}
                      onValueChange={(v) => setDraft({ ...draft, fontPath: v === DEFAULT_FONT ? null : v })}
                    >
                      <SelectTrigger className="min-w-0 flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DEFAULT_FONT}>Noto Sans Bengali Bold (default)</SelectItem>
                        {fonts.map((f) => (
                          <SelectItem key={f.fontPath} value={f.fontPath}>
                            {f.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <input
                      ref={fontInput}
                      type="file"
                      accept=".ttf,.otf,font/ttf,font/otf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) uploadFont(f);
                      }}
                    />
                    <Button type="button" variant="outline" onClick={() => fontInput.current?.click()}>
                      Upload font
                    </Button>
                  </div>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="d-max">Largest text (pt)</Label>
                  <Input
                    id="d-max"
                    type="number"
                    step="0.5"
                    value={draft.maxFontPt}
                    onChange={(e) => setDraft({ ...draft, maxFontPt: e.target.value })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="d-min">Smallest text (pt)</Label>
                  <Input
                    id="d-min"
                    type="number"
                    step="0.5"
                    value={draft.minFontPt}
                    onChange={(e) => setDraft({ ...draft, minFontPt: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Long messages shrink from the largest size down to the smallest; below that the SE
                is asked to shorten the message.
              </p>

              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Preview</p>
                  <span className="text-xs text-muted-foreground">
                    {previewing
                      ? "Rendering…"
                      : preview
                        ? preview.fits
                          ? `Fits at ${preview.pt} pt`
                          : "Too long even at the smallest size"
                        : ""}
                  </span>
                </div>
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview.url}
                    alt="Card preview"
                    className={`w-full rounded border ${preview.fits ? "" : "ring-2 ring-destructive"}`}
                  />
                ) : (
                  <div
                    className="grid w-full place-items-center rounded border bg-white text-xs text-muted-foreground"
                    style={{ aspectRatio: String(size.w / size.h) }}
                  >
                    {previewing ? "Rendering…" : "Preview appears here"}
                  </div>
                )}
                <Textarea
                  rows={3}
                  aria-label="Sample message"
                  value={sample}
                  onChange={(e) => setSample(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input aria-label="Sample To name" placeholder="To" value={toName} onChange={(e) => setToName(e.target.value)} />
                  <Input aria-label="Sample From name" placeholder="From" value={fromName} onChange={(e) => setFromName(e.target.value)} />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <Switch checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} />
                Active (offered on the order form)
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button onClick={save} disabled={busy || !draft.name.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
