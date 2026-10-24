"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CardDesignRow, CardMessageRow } from "@/lib/card-library";
import { CARD_LANGUAGES, CARD_LANGUAGE_LABELS, hasNameSlots } from "@/lib/print-constants";
import { CARD_TEXT_MAX } from "@/lib/print-card-text";
import type { CardSlot, PrintSize } from "@/lib/print-layouts";

// PHOTO_PRINT.md PP-4 — one card: design → occasion → message (by language),
// or the customer's own words. Name boxes only for a message with {to}/{from}.
// The preview is rendered by the print renderer at the card's real shape.

export interface CardChoiceDraft {
  designId: number;
  messageId: number | null;
  text?: string;
  toName?: string | null;
  fromName?: string | null;
}

let libraryPromise: Promise<{ designs: CardDesignRow[]; messages: CardMessageRow[] }> | null = null;

/** Active designs + messages, loaded once per page. */
export function loadCardLibrary() {
  libraryPromise ??= Promise.all([
    fetch("/api/print/card-designs").then((r) => (r.ok ? r.json() : [])),
    fetch("/api/print/card-messages").then((r) => (r.ok ? r.json() : [])),
  ])
    .then(([designs, messages]) => ({
      designs: (designs as CardDesignRow[]).filter((d) => d.isActive),
      messages: (messages as CardMessageRow[]).filter((m) => m.isActive),
    }))
    .catch((e) => {
      libraryPromise = null;
      throw e;
    });
  return libraryPromise;
}

const CUSTOM = -1;
const ALL = "__all";

/** Mount it only while open — it starts from `initial`. */
export function CardPicker({
  onOpenChange,
  slot,
  size,
  initial,
  onSave,
}: {
  onOpenChange: (v: boolean) => void;
  slot: CardSlot;
  size: PrintSize;
  initial: CardChoiceDraft | null;
  /** Saves the choice; throws with the message to show when refused. */
  onSave: (choice: CardChoiceDraft, previewUrl: string | null) => Promise<void>;
}) {
  const [lib, setLib] = useState<{ designs: CardDesignRow[]; messages: CardMessageRow[] } | null>(null);
  const [pickedDesign, setDesignId] = useState<number | null>(initial?.designId ?? null);
  const [occasion, setOccasion] = useState(ALL);
  const [language, setLanguage] = useState(ALL);
  const [messageId, setMessageId] = useState<number | null>(initial ? (initial.messageId ?? CUSTOM) : null);
  const [custom, setCustom] = useState(initial && initial.messageId == null ? (initial.text ?? "") : "");
  const [toName, setToName] = useState(initial?.toName ?? "");
  const [fromName, setFromName] = useState(initial?.fromName ?? "");
  const [preview, setPreview] = useState<{ key: string; url: string; fits: boolean; pt: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCardLibrary().then(setLib, () => setError("Could not load the card library"));
  }, []);

  const designs = useMemo(() => (lib?.designs ?? []).filter((d) => d.slot === slot), [lib, slot]);
  // With a single design for this card, it is the pick.
  const designId = pickedDesign ?? (designs.length === 1 ? designs[0].id : null);
  const design = designs.find((d) => d.id === designId) ?? null;
  const occasions = useMemo(() => [...new Set((lib?.messages ?? []).map((m) => m.occasion))], [lib]);
  const messages = (lib?.messages ?? []).filter(
    (m) => (occasion === ALL || m.occasion === occasion) && (language === ALL || m.language === language)
  );
  const message = lib?.messages.find((m) => m.id === messageId) ?? null;
  const text = messageId === CUSTOM ? custom : (message?.text ?? "");
  const withNames = messageId !== CUSTOM && hasNameSlots(text);

  const choice: CardChoiceDraft | null =
    design && text.trim()
      ? messageId === CUSTOM
        ? { designId: design.id, messageId: null, text: custom.trim() }
        : { designId: design.id, messageId: messageId!, toName: toName.trim() || null, fromName: fromName.trim() || null }
      : null;

  // Live preview — debounced; the same renderer as the print PDF.
  const previewKey = design && text.trim() ? JSON.stringify([design, text, toName, fromName, withNames]) : "";
  useEffect(() => {
    if (!previewKey || !design) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setPreviewing(true);
      try {
        const res = await fetch("/api/print/card-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            slot,
            design,
            text,
            to: withNames ? toName : "",
            from: withNames ? fromName : "",
            width: 600,
          }),
        });
        if (!res.ok) throw new Error();
        const blob = await res.blob();
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return {
            key: previewKey,
            url: URL.createObjectURL(blob),
            fits: res.headers.get("X-Card-Fits") === "1",
            pt: res.headers.get("X-Card-Font-Pt") ?? "",
          };
        });
      } catch {
        // aborted / failed — the stale preview is hidden by its key
      } finally {
        setPreviewing(false);
      }
    }, 450);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  // A preview for different settings is never shown (or trusted).
  const shown = preview && preview.key === previewKey ? preview : null;

  async function save() {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(choice, shown?.url ?? null);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the card");
    } finally {
      setBusy(false);
    }
  }

  const aspect = size.w / size.h;
  const label = slot === "CARD_1" ? "Card 1 (large)" : "Card 2 (small)";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{label} — কার্ড বাছাই</DialogTitle>
          <DialogDescription>Design → message (or the customer&apos;s own words) → names.</DialogDescription>
        </DialogHeader>
        {!lib ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{error ?? "Loading…"}</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <div className="min-w-0 space-y-4">
              <div className="space-y-1.5">
                <Label>1 · ডিজাইন / Design</Label>
                {designs.length === 0 ? (
                  <p className="text-sm text-destructive">
                    No active design for {label} yet — ask the Admin to add one (Settings → Gift Print).
                  </p>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {designs.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setDesignId(d.id)}
                        aria-pressed={d.id === designId}
                        className={`w-24 shrink-0 overflow-hidden rounded-md border-2 text-left ${
                          d.id === designId ? "border-primary" : "border-transparent hover:border-muted-foreground/30"
                        }`}
                      >
                        <div className="bg-white" style={{ aspectRatio: String(aspect) }}>
                          {d.backgroundPath && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={d.backgroundPath} alt="" className="h-full w-full object-cover" />
                          )}
                        </div>
                        <p className="truncate px-1 py-0.5 text-[11px]">{d.name}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>2 · মেসেজ / Message</Label>
                <div className="flex flex-wrap gap-1">
                  {[ALL, ...occasions].map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setOccasion(o)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${
                        occasion === o ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                      }`}
                    >
                      {o === ALL ? "সব / All" : o}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1">
                  {[ALL, ...CARD_LANGUAGES].map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLanguage(l)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${
                        language === l ? "border-foreground/60 bg-muted font-medium" : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {l === ALL ? "Any language" : CARD_LANGUAGE_LABELS[l as keyof typeof CARD_LANGUAGE_LABELS]}
                    </button>
                  ))}
                </div>
                <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border p-1.5">
                  {messages.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMessageId(m.id)}
                      aria-pressed={m.id === messageId}
                      className={`block w-full rounded-md border px-2.5 py-2 text-left text-sm leading-relaxed ${
                        m.id === messageId ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"
                      }`}
                    >
                      {m.text}
                    </button>
                  ))}
                  {messages.length === 0 && (
                    <p className="px-2 py-3 text-xs text-muted-foreground">No message for this occasion/language.</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setMessageId(CUSTOM)}
                  aria-pressed={messageId === CUSTOM}
                  className={`w-full rounded-md border px-2.5 py-2 text-left text-sm ${
                    messageId === CUSTOM ? "border-primary bg-primary/5" : "hover:bg-muted"
                  }`}
                >
                  ✍️ নিজের লেখা / Custom message (the customer&apos;s own words)
                </button>
                {messageId === CUSTOM && (
                  <div className="space-y-1">
                    <Textarea
                      rows={4}
                      maxLength={CARD_TEXT_MAX}
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                      placeholder="কাস্টমারের লেখা এখানে / Type the customer's message, names included"
                      aria-label="Custom message"
                    />
                    <p className="text-right text-xs text-muted-foreground">
                      {custom.length}/{CARD_TEXT_MAX}
                    </p>
                  </div>
                )}
              </div>

              {withNames && (
                <div className="space-y-1.5">
                  <Label>3 · নাম / Names (optional)</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {text.includes("{to}") && (
                      <Input
                        value={toName}
                        maxLength={60}
                        onChange={(e) => setToName(e.target.value)}
                        placeholder="যাকে দেবেন / To"
                        aria-label="To name"
                      />
                    )}
                    {text.includes("{from}") && (
                      <Input
                        value={fromName}
                        maxLength={60}
                        onChange={(e) => setFromName(e.target.value)}
                        placeholder="যে দিচ্ছেন / From"
                        aria-label="From name"
                      />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Left empty, that name line is left out.</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Preview</Label>
                <span className="text-xs text-muted-foreground">
                  {previewing ? "Rendering…" : shown ? (shown.fits ? `Fits at ${shown.pt} pt` : "") : ""}
                </span>
              </div>
              {shown ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shown.url}
                  alt="Card preview"
                  className={`w-full rounded border ${shown.fits ? "" : "ring-2 ring-destructive"}`}
                />
              ) : (
                <div
                  className="grid w-full place-items-center rounded border bg-white text-xs text-muted-foreground"
                  style={{ aspectRatio: String(aspect) }}
                >
                  {previewing ? "Rendering…" : "Pick a design and a message"}
                </div>
              )}
              {shown && !shown.fits && (
                <p className="text-sm font-medium text-destructive">
                  মেসেজটা বড় — একটু ছোট করুন / Too long for this card — please shorten it.
                </p>
              )}
            </div>
          </div>
        )}
        {error && lib && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !choice || previewing || !shown || !shown.fits}>
            {busy ? "Saving…" : "Use this card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
