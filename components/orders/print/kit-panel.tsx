"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  describePrintKit,
  kitProgress,
  kitProgressLabel,
  type KitPhotoView,
  type PrintKitSpec,
  type PrintKitStatusValue,
} from "@/lib/print-kit";
import type { CardSlot, PhotoSlot, PrintSizes } from "@/lib/print-layouts";
import { LOW_RES_DPI, cropBox, cropDpi, type PhotoCrop } from "@/lib/print-crop";
import { CropDialog, CroppedImage } from "./crop-dialog";
import { CardPicker, type CardChoiceDraft } from "./card-picker";
import { prepareImage, runLimited, UploadError } from "./upload";

// PHOTO_PRINT.md PP-4 — one kit's photos and cards. The same panel serves the
// new-order form (photos staged until the order is saved) and the order page
// (every change saved at once); the difference lives in the KitAdapter.
//
// Phone first: pick all photos at once; each uploads with its own progress
// and Retry. Tap a photo, then tap another slot to move/swap it (big ↔ small
// too) — drag-and-drop is unreliable in phone browsers.

export interface SlotRef {
  slot: PhotoSlot;
  position: number;
}

export interface PanelCard {
  slot: CardSlot;
  designName: string;
  text: string;
  renderUrl: string | null;
  choice: CardChoiceDraft;
}

export interface PanelKit {
  key: string;
  label: string;
  spec: PrintKitSpec;
  photos: KitPhotoView[];
  cards: PanelCard[];
  status?: PrintKitStatusValue;
  orphaned?: boolean;
}

export interface KitAdapter {
  upload(kit: PanelKit, file: Blob, name: string, target: SlotRef, onProgress: (f: number) => void): Promise<void>;
  move(kit: PanelKit, from: SlotRef, to: SlotRef): Promise<void>;
  crop(kit: PanelKit, photo: KitPhotoView, crop: PhotoCrop): Promise<void>;
  remove(kit: PanelKit, photo: KitPhotoView): Promise<void>;
  setCard(kit: PanelKit, slot: CardSlot, choice: CardChoiceDraft, previewUrl: string | null): Promise<void>;
  clearCard(kit: PanelKit, slot: CardSlot): Promise<void>;
  deleteKit?(kit: PanelKit): Promise<void>;
}

interface QueueItem {
  id: number;
  name: string;
  file: File;
  target: SlotRef;
  progress: number;
  state: "waiting" | "uploading" | "error";
  error?: string;
}

const SLOT_TITLE: Record<PhotoSlot, string> = { PHOTO_L: "বড় ছবি / Big photos", PHOTO_S: "ছোট ছবি / Small photos" };
const sameRef = (a: SlotRef | null, b: SlotRef | null) => !!a && !!b && a.slot === b.slot && a.position === b.position;
let queueId = 1;

/** Same rule as the server's print file: the cut below 150 DPI on this slot. */
function isLowResAt(p: KitPhotoView, size: { w: number; h: number }) {
  return cropDpi(cropBox(p.srcWidth, p.srcHeight, size.w / size.h, p.crop), size.w) < LOW_RES_DPI;
}

export function KitPanel({
  kit,
  sizes,
  canEdit,
  adapter,
}: {
  kit: PanelKit;
  sizes: PrintSizes;
  canEdit: boolean;
  adapter: KitAdapter;
}) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selected, setSelected] = useState<SlotRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [cropping, setCropping] = useState<KitPhotoView | null>(null);
  const [picking, setPicking] = useState<CardSlot | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<SlotRef | null>(null);

  const progress = kitProgress(kit.spec, kit.photos.length, kit.cards.length);
  const label = kitProgressLabel(progress);
  const photoAt = (r: SlotRef) => kit.photos.find((p) => p.slot === r.slot && p.position === r.position) ?? null;
  const reserved = (r: SlotRef) => queue.some((q) => sameRef(q.target, r));

  /** Empty slots in fill order (big first), skipping ones an upload holds. */
  function freeSlots(): SlotRef[] {
    const out: SlotRef[] = [];
    for (const slot of ["PHOTO_L", "PHOTO_S"] as PhotoSlot[]) {
      for (let position = 1; position <= kit.spec.photos[slot]; position++) {
        const r = { slot, position };
        if (!photoAt(r) && !reserved(r)) out.push(r);
      }
    }
    return out;
  }

  async function runItem(item: QueueItem) {
    const patch = (p: Partial<QueueItem>) =>
      setQueue((q) => q.map((x) => (x.id === item.id ? { ...x, ...p } : x)));
    patch({ state: "uploading", progress: 0, error: undefined });
    try {
      const blob = await prepareImage(item.file);
      await adapter.upload(kit, blob, item.name, item.target, (f) => patch({ progress: f }));
      setQueue((q) => q.filter((x) => x.id !== item.id));
    } catch (e) {
      patch({ state: "error", error: e instanceof UploadError || e instanceof Error ? e.message : "Upload failed" });
    }
  }

  function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = [...files];
    let targets: SlotRef[];
    if (replaceTarget.current) {
      targets = [replaceTarget.current];
      replaceTarget.current = null;
    } else {
      targets = freeSlots();
    }
    if (list.length > targets.length) {
      toast.warning(
        targets.length === 0
          ? "সব ছবি দেওয়া হয়ে গেছে / All photo slots are full — replace or delete one first"
          : `শুধু ${targets.length}টা জায়গা খালি / Only ${targets.length} slot(s) free — the first ${targets.length} photo(s) were taken`
      );
    }
    const items: QueueItem[] = list.slice(0, targets.length).map((file, i) => ({
      id: queueId++,
      name: file.name,
      file,
      target: targets[i],
      progress: 0,
      state: "waiting",
    }));
    if (items.length === 0) return;
    setQueue((q) => [...q, ...items]);
    void runLimited(items.map((it) => () => runItem(it)), 3);
  }

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function onTile(r: SlotRef) {
    if (!canEdit || busy) return;
    const photo = photoAt(r);
    if (selected) {
      if (sameRef(selected, r)) {
        setSelected(null);
        return;
      }
      const from = selected;
      setSelected(null);
      void act(() => adapter.move(kit, from, r));
      return;
    }
    if (photo) setSelected(r);
    else if (!reserved(r)) {
      replaceTarget.current = r;
      fileInput.current?.click();
    }
  }

  const selectedPhoto = selected ? photoAt(selected) : null;
  const sizeOf = (slot: PhotoSlot) => sizes[slot];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{kit.label}</p>
        {/* Printed replaces "Ready to print" — one clear state. */}
        {kit.status === "PRINTED" ? (
          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">✓ প্রিন্ট হয়েছে / Printed</Badge>
        ) : (
          <Badge
            variant="outline"
            className={
              progress.state === "READY"
                ? "border-emerald-400 text-emerald-700 dark:text-emerald-400"
                : "border-amber-400 text-amber-700 dark:text-amber-400"
            }
            title={label.bn}
          >
            {label.en}
          </Badge>
        )}
        {kit.status === "CHANGED_AFTER_PRINT" && (
          <Badge variant="outline" className="border-destructive text-destructive">
            Changed after print — reprint
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">{describePrintKit(kit.spec)}</span>
      </div>
      {kit.orphaned && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-400/60 bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <span>এই কিটের লাইন অর্ডার থেকে সরানো হয়েছে / This kit&apos;s line was removed from the order.</span>
          {adapter.deleteKit && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => adapter.deleteKit!(kit))}>
              Delete kit
            </Button>
          )}
        </div>
      )}

      {canEdit && kit.spec.photos.PHOTO_L + kit.spec.photos.PHOTO_S > 0 && (
        <div className="space-y-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => {
                replaceTarget.current = null;
                fileInput.current?.click();
              }}
              disabled={progress.photos >= progress.photosNeeded && queue.length === 0}
            >
              📷 ছবি যোগ করুন / Add photos
            </Button>
            <span className="text-xs text-muted-foreground">
              Pick all {progress.photosNeeded} at once — first {kit.spec.photos.PHOTO_L} go to big, the rest to small.
            </span>
          </div>
          {queue.length > 0 && (
            <ul className="space-y-1">
              {queue.map((q) => (
                <li key={q.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                  <span className="min-w-0 flex-1 truncate">{q.name}</span>
                  {q.state === "error" ? (
                    <>
                      <span className="max-w-[45%] truncate text-destructive" title={q.error}>
                        {q.error}
                      </span>
                      <Button size="sm" variant="outline" className="h-6 px-2" onClick={() => void runItem(q)}>
                        আবার / Retry
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2"
                        onClick={() => setQueue((list) => list.filter((x) => x.id !== q.id))}
                        aria-label="Remove from queue"
                      >
                        ✕
                      </Button>
                    </>
                  ) : (
                    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted" aria-label="Upload progress">
                      <div
                        className="h-full bg-primary transition-[width]"
                        style={{ width: `${Math.round((q.state === "waiting" ? 0 : q.progress) * 100)}%` }}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(["PHOTO_L", "PHOTO_S"] as PhotoSlot[]).map((slot) =>
        kit.spec.photos[slot] === 0 ? null : (
          <div key={slot} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              {SLOT_TITLE[slot]} ({kit.photos.filter((p) => p.slot === slot).length}/{kit.spec.photos[slot]}) ·{" "}
              {sizeOf(slot).w} × {sizeOf(slot).h} mm
            </p>
            <div className={`grid gap-1.5 ${slot === "PHOTO_L" ? "grid-cols-4 sm:grid-cols-5" : "grid-cols-5 sm:grid-cols-8"}`}>
              {Array.from({ length: kit.spec.photos[slot] }, (_, i) => {
                const r = { slot, position: i + 1 };
                const photo = photoAt(r);
                const isSel = sameRef(selected, r);
                const uploading = queue.find((q) => sameRef(q.target, r));
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onTile(r)}
                    disabled={!canEdit && !photo}
                    className={`relative overflow-hidden rounded-sm border text-left ${
                      isSel ? "ring-2 ring-primary ring-offset-1" : selected ? "ring-1 ring-primary/40" : ""
                    }`}
                    aria-label={`${slot === "PHOTO_L" ? "Big" : "Small"} ${i + 1}${photo ? "" : " (empty)"}`}
                  >
                    {photo ? (
                      <CroppedImage photo={photo} crop={photo.crop} aspect={sizeOf(slot).w / sizeOf(slot).h} />
                    ) : (
                      <div
                        className="grid place-items-center border-dashed bg-muted/40 text-[10px] text-muted-foreground"
                        style={{ aspectRatio: String(sizeOf(slot).w / sizeOf(slot).h) }}
                      >
                        {uploading ? `${Math.round(uploading.progress * 100)}%` : canEdit ? "+" : "—"}
                      </div>
                    )}
                    <span className="absolute left-0.5 top-0.5 rounded bg-black/50 px-1 text-[9px] text-white">{i + 1}</span>
                    {photo && isLowResAt(photo, sizeOf(slot)) && (
                      <span
                        className="absolute bottom-0.5 right-0.5 rounded bg-amber-500 px-1 text-[9px] font-medium text-white"
                        title="ছবিটা ছোট — প্রিন্ট ঝাপসা হতে পারে / Low resolution — print may be blurry"
                      >
                        ⚠ low-res
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )
      )}

      {canEdit && selectedPhoto && selected && (
        <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-background p-2 shadow-md">
          <span className="text-xs text-muted-foreground">
            {selected.slot === "PHOTO_L" ? "Big" : "Small"} {selected.position} — অন্য ঘরে ট্যাপ করে সরান / tap
            another slot to move it there
          </span>
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setCropping(selectedPhoto)}>
              Crop
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                replaceTarget.current = selected;
                setSelected(null);
                fileInput.current?.click();
              }}
            >
              Replace
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              disabled={busy}
              onClick={() => {
                const p = selectedPhoto;
                setSelected(null);
                void act(() => adapter.remove(kit, p));
              }}
            >
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {kit.spec.cards.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">কার্ড / Cards ({kit.cards.length}/{kit.spec.cards.length})</p>
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            {kit.spec.cards.map((slot) => {
              const card = kit.cards.find((c) => c.slot === slot) ?? null;
              const aspect = sizes[slot].w / sizes[slot].h;
              return (
                <div key={slot} className="space-y-1">
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setPicking(slot)}
                    className="block w-full overflow-hidden rounded-sm border bg-white"
                    style={{ aspectRatio: String(aspect) }}
                    aria-label={`${slot === "CARD_1" ? "Card 1" : "Card 2"} — ${card ? "change" : "choose"}`}
                  >
                    {card?.renderUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={card.renderUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full place-items-center px-2 text-center text-xs text-muted-foreground">
                        {card ? card.text : canEdit ? "কার্ড বাছুন / Choose card" : "No card yet"}
                      </span>
                    )}
                  </button>
                  <div className="flex items-center justify-between gap-1 text-[11px]">
                    <span className="truncate text-muted-foreground">
                      {slot === "CARD_1" ? "Card 1" : "Card 2"}
                      {card ? ` · ${card.designName}` : ""}
                    </span>
                    {canEdit && card && (
                      <button
                        type="button"
                        className="text-destructive hover:underline"
                        onClick={() => act(() => adapter.clearCard(kit, slot))}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {cropping && (
      <CropDialog
        onOpenChange={(v) => !v && setCropping(null)}
        photo={cropping}
        size={sizeOf(cropping.slot)}
        title={`${cropping.slot === "PHOTO_L" ? "Big" : "Small"} photo ${cropping.position}`}
        onSave={async (crop) => {
          try {
            await adapter.crop(kit, cropping, crop);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not save the crop");
            throw e;
          }
        }}
      />
      )}
      {picking && (
        <CardPicker
          onOpenChange={(v) => !v && setPicking(null)}
          slot={picking}
          size={sizes[picking]}
          initial={kit.cards.find((c) => c.slot === picking)?.choice ?? null}
          onSave={(choice, previewUrl) => adapter.setCard(kit, picking, choice, previewUrl)}
        />
      )}
    </div>
  );
}
