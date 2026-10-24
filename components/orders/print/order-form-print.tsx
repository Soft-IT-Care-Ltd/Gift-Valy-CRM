"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { KitPhotoView, PrintKitSpec } from "@/lib/print-kit";
import type { PrintSizes } from "@/lib/print-layouts";
import { KitPanel, type KitAdapter, type PanelCard, type PanelKit } from "./kit-panel";
import { loadCardLibrary } from "./card-picker";
import { uploadWithProgress } from "./upload";

// PHOTO_PRINT.md PP-4 — "C2 · Photos & cards" on the NEW order form. The
// order doesn't exist yet, so photos upload "staged" under this form's token
// and cards are kept here; saving the order sends them as `printKits`, keyed
// by the source keys /api/print/kits-preview gives for the current lines
// (the server gives the saved kits the same keys).

export interface FormItemForPrint {
  itemType: "PRODUCT" | "PACKAGE";
  productId: number | null;
  packageId: number | null;
  qty: number;
  choiceSelections: Record<string, number> | null;
}

interface PreviewKit {
  sourceKey: string;
  productId: number;
  label: string;
  spec: PrintKitSpec;
}

interface Content {
  photos: KitPhotoView[];
  cards: PanelCard[];
}

export interface PrintKitsPayload {
  sourceKey: string;
  photos: { id: number; slot: string; position: number; crop: { cx: number; cy: number; zoom: number } }[];
  cards: { slot: string; choice: PanelCard["choice"] }[];
}

function newToken(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

const hasContent = (c?: Content) => !!c && (c.photos.length > 0 || c.cards.length > 0);

export function OrderFormPrint({
  items,
  sizes,
  onChange,
}: {
  items: FormItemForPrint[];
  sizes: PrintSizes;
  /** The payload for POST /api/orders + whether uploads are still running. */
  onChange: (payload: PrintKitsPayload[], uploading: boolean) => void;
}) {
  const [token] = useState(newToken);
  const [kits, setKits] = useState<PreviewKit[]>([]);
  const [content, setContent] = useState<Record<string, Content>>({});
  const [uploading, setUploading] = useState(0);
  const [tab, setTab] = useState(0);
  const prevKits = useRef<PreviewKit[]>([]);

  // Which kits the current lines need — debounced.
  const itemsKey = JSON.stringify(items);
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/print/kits-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        setKits((await res.json()).kits as PreviewKit[]);
      } catch {
        // aborted / offline — keep the last answer
      }
    }, 500);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  // A kit that disappeared (line changed) hands its photos/cards to a new kit
  // of the same product; with none, its staged photos are discarded.
  useEffect(() => {
    const before = prevKits.current;
    prevKits.current = kits;
    const keys = new Set(kits.map((k) => k.sourceKey));
    const gone = before.filter((k) => !keys.has(k.sourceKey));
    if (gone.length === 0) return;
    setContent((c) => {
      const next = { ...c };
      const claimed = new Set<string>();
      for (const g of gone) {
        const had = next[g.sourceKey];
        delete next[g.sourceKey];
        if (!hasContent(had)) continue;
        const heir = kits.find(
          (k) => k.productId === g.productId && !claimed.has(k.sourceKey) && !hasContent(next[k.sourceKey])
        );
        if (heir) {
          claimed.add(heir.sourceKey);
          next[heir.sourceKey] = had!;
        } else {
          for (const p of had!.photos) void fetch(`/api/print/staged-photos/${p.id}`, { method: "DELETE" });
          toast.warning("একটা কিট বাদ পড়েছে — তার ছবিগুলো মুছে ফেলা হলো / A kit was removed — its photos were discarded");
        }
      }
      return next;
    });
  }, [kits]);

  // Report the payload upward.
  useEffect(() => {
    const payload: PrintKitsPayload[] = kits
      .filter((k) => hasContent(content[k.sourceKey]))
      .map((k) => ({
        sourceKey: k.sourceKey,
        photos: content[k.sourceKey].photos.map((p) => ({ id: p.id, slot: p.slot, position: p.position, crop: p.crop })),
        cards: content[k.sourceKey].cards.map((c) => ({ slot: c.slot, choice: c.choice })),
      }));
    onChange(payload, uploading > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kits, content, uploading]);

  if (kits.length === 0) return null;

  const update = (key: string, fn: (c: Content) => Content) =>
    setContent((all) => ({ ...all, [key]: fn(all[key] ?? { photos: [], cards: [] }) }));

  const adapter: KitAdapter = {
    async upload(kit, file, name, target, onProgress) {
      setUploading((n) => n + 1);
      try {
        const form = new FormData();
        form.append("file", file, name);
        form.append("token", token);
        const photo = await uploadWithProgress<KitPhotoView>("/api/print/staged-photos", form, onProgress);
        update(kit.key, (c) => {
          const replaced = c.photos.find((p) => p.slot === target.slot && p.position === target.position);
          if (replaced) void fetch(`/api/print/staged-photos/${replaced.id}`, { method: "DELETE" });
          return {
            ...c,
            photos: [...c.photos.filter((p) => p !== replaced), { ...photo, slot: target.slot, position: target.position }],
          };
        });
      } finally {
        setUploading((n) => n - 1);
      }
    },
    async move(kit, from, to) {
      update(kit.key, (c) => ({
        ...c,
        photos: c.photos.map((p) =>
          p.slot === from.slot && p.position === from.position
            ? { ...p, ...to }
            : p.slot === to.slot && p.position === to.position
              ? { ...p, ...from }
              : p
        ),
      }));
    },
    async crop(kit, photo, crop) {
      update(kit.key, (c) => ({ ...c, photos: c.photos.map((p) => (p.id === photo.id ? { ...p, crop } : p)) }));
    },
    async remove(kit, photo) {
      await fetch(`/api/print/staged-photos/${photo.id}`, { method: "DELETE" });
      update(kit.key, (c) => ({ ...c, photos: c.photos.filter((p) => p.id !== photo.id) }));
    },
    async setCard(kit, slot, choice, previewUrl) {
      const lib = await loadCardLibrary();
      const design = lib.designs.find((d) => d.id === choice.designId);
      const message = lib.messages.find((m) => m.id === choice.messageId);
      // Own copy of the preview image — the picker frees its URLs.
      let renderUrl: string | null = null;
      if (previewUrl) renderUrl = URL.createObjectURL(await (await fetch(previewUrl)).blob());
      const card: PanelCard = {
        slot,
        designName: design?.name ?? "",
        text: message?.text ?? choice.text ?? "",
        renderUrl,
        choice,
      };
      update(kit.key, (c) => ({ ...c, cards: [...c.cards.filter((x) => x.slot !== slot), card] }));
    },
    async clearCard(kit, slot) {
      update(kit.key, (c) => ({ ...c, cards: c.cards.filter((x) => x.slot !== slot) }));
    },
  };

  const current = kits[Math.min(tab, kits.length - 1)];
  const panel: PanelKit = {
    key: current.sourceKey,
    label: current.label,
    spec: current.spec,
    photos: content[current.sourceKey]?.photos ?? [],
    cards: content[current.sourceKey]?.cards ?? [],
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>C2 · ছবি ও কার্ড / Photos &amp; cards</CardTitle>
        <CardDescription>
          ছবি পরে দিলেও অর্ডার সেভ করা যাবে — অর্ডার পেজে বাকি ছবি দিন / The order can be saved with
          photos missing — add the rest on the order page later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {kits.length > 1 && (
          <div className="flex gap-1 overflow-x-auto border-b">
            {kits.map((k, i) => {
              const c = content[k.sourceKey];
              const n = c?.photos.length ?? 0;
              const need = k.spec.photos.PHOTO_L + k.spec.photos.PHOTO_S;
              return (
                <button
                  key={k.sourceKey}
                  type="button"
                  onClick={() => setTab(i)}
                  className={`-mb-px whitespace-nowrap border-b-2 px-3 py-1.5 text-xs font-medium ${
                    i === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                  }`}
                >
                  Kit {i + 1} · {n}/{need}
                </button>
              );
            })}
          </div>
        )}
        <KitPanel kit={panel} sizes={sizes} canEdit adapter={adapter} key={current.sourceKey} />
      </CardContent>
    </Card>
  );
}
