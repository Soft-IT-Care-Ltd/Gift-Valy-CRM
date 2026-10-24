"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CROP_MAX_ZOOM,
  LOW_RES_DPI,
  clampCrop,
  cropBox,
  cropDpi,
  type PhotoCrop,
} from "@/lib/print-crop";
import type { PrintSize } from "@/lib/print-layouts";

// PHOTO_PRINT.md PP-4 — the photo as it will be cut. Uses lib/print-crop.ts —
// the same math as the server's print file — so the preview IS the print.

export interface CroppablePhoto {
  url: string;
  srcWidth: number;
  srcHeight: number;
  crop: PhotoCrop;
  focus: PhotoCrop;
}

/** The photo cut to `aspect`, filling its box (pure CSS, any size). */
export function CroppedImage({
  photo,
  crop,
  aspect,
  className = "",
}: {
  photo: Pick<CroppablePhoto, "url" | "srcWidth" | "srcHeight">;
  crop: PhotoCrop;
  aspect: number;
  className?: string;
}) {
  const box = cropBox(photo.srcWidth, photo.srcHeight, aspect, crop);
  return (
    <div className={`relative overflow-hidden bg-muted ${className}`} style={{ aspectRatio: String(aspect) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt=""
        draggable={false}
        className="pointer-events-none absolute max-w-none select-none"
        style={{
          width: `${(photo.srcWidth / box.width) * 100}%`,
          height: `${(photo.srcHeight / box.height) * 100}%`,
          left: `${(-box.left / box.width) * 100}%`,
          top: `${(-box.top / box.height) * 100}%`,
        }}
      />
    </div>
  );
}

/** Mount it only while open — it starts from the photo's saved crop. */
export function CropDialog({
  onOpenChange,
  photo,
  size,
  title,
  onSave,
}: {
  onOpenChange: (v: boolean) => void;
  photo: CroppablePhoto;
  size: PrintSize;
  title: string;
  onSave: (crop: PhotoCrop) => Promise<void> | void;
}) {
  const aspect = size.w / size.h;
  const [crop, setCrop] = useState<PhotoCrop>(() =>
    clampCrop(photo.srcWidth, photo.srcHeight, aspect, photo.crop)
  );
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; start: PhotoCrop } | null>(null);

  const box = cropBox(photo.srcWidth, photo.srcHeight, aspect, crop);
  const dpi = Math.round(cropDpi(box, size.w));

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: crop };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const el = frame.current;
    if (!d || !el) return;
    // Screen px → original px: the frame shows `box.width` original px.
    const scale = box.width / el.getBoundingClientRect().width;
    const dx = ((e.clientX - d.x) * scale) / photo.srcWidth;
    const dy = ((e.clientY - d.y) * scale) / photo.srcHeight;
    setCrop(
      clampCrop(photo.srcWidth, photo.srcHeight, aspect, {
        ...d.start,
        cx: d.start.cx - dx,
        cy: d.start.cy - dy,
      })
    );
  }

  async function save() {
    setBusy(true);
    try {
      await onSave(crop);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            টেনে সরান, স্লাইডারে জুম করুন / Drag to move, slide to zoom. The frame is exactly what
            prints ({size.w} × {size.h} mm).
          </DialogDescription>
        </DialogHeader>
        <div
          ref={frame}
          className="mx-auto w-full max-w-sm cursor-grab touch-none overflow-hidden rounded-sm border active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          <CroppedImage photo={photo} crop={crop} aspect={aspect} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Zoom</span>
          <input
            type="range"
            min={1}
            max={CROP_MAX_ZOOM}
            step={0.05}
            value={crop.zoom}
            aria-label="Zoom"
            onChange={(e) =>
              setCrop(
                clampCrop(photo.srcWidth, photo.srcHeight, aspect, { ...crop, zoom: Number(e.target.value) })
              )
            }
            className="flex-1 accent-primary"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCrop(clampCrop(photo.srcWidth, photo.srcHeight, aspect, photo.focus))}
          >
            Reset
          </Button>
        </div>
        <p className={`text-xs ${dpi < LOW_RES_DPI ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
          {dpi < LOW_RES_DPI
            ? `ছবিটা ছোট — প্রিন্ট ঝাপসা হতে পারে / Low resolution (${dpi} DPI) — print may be blurry`
            : `Print quality: ${dpi} DPI`}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save crop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
