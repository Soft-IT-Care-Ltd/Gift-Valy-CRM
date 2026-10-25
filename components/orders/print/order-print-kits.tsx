"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { KitView, OrderPrintStatus } from "@/lib/print-kit";
import type { PrintSizes } from "@/lib/print-layouts";
import { KitPanel, type KitAdapter, type PanelKit } from "./kit-panel";
import { uploadWithProgress } from "./upload";
import { PrintBar } from "./print-bar";

// PHOTO_PRINT.md PP-4 — "Photos & cards" on the order page. Every change is
// saved at once (and audited); each call answers with the order's kits.

export function toPanelKit(k: KitView): PanelKit {
  return {
    key: String(k.id),
    label: k.label,
    spec: k.spec,
    photos: k.photos,
    status: k.status,
    orphaned: k.orphaned,
    cards: k.cards.map((c) => ({
      slot: c.slot,
      designName: c.designName,
      text: c.text,
      renderUrl: c.renderUrl,
      choice: {
        designId: c.designId,
        messageId: c.messageId,
        text: c.messageId == null ? c.text : undefined,
        toName: c.toName,
        fromName: c.fromName,
      },
    })),
  };
}

async function call(url: string, method: string, body?: unknown): Promise<KitView[]> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Could not save");
  return data.kits;
}

export function OrderPrintKits({
  initialKits,
  sizes,
  canEdit,
  canDeleteKit,
  locked,
  print,
}: {
  initialKits: KitView[];
  sizes: PrintSizes;
  canEdit: boolean;
  canDeleteKit: boolean;
  /** Shown when print.edit is held but the order is past PACKED. */
  locked: boolean;
  /** PP-7 — print / mark printed right here (not only on the Packing queue). */
  print?: { orderId: number; orderNo: string; status: OrderPrintStatus; canPrint: boolean; borderless: boolean };
}) {
  const router = useRouter();
  const [kits, setKitsState] = useState(initialKits);
  const [tab, setTab] = useState(0);
  // A server refresh (e.g. after Mark printed) brings new kits — show them.
  const [seen, setSeen] = useState(initialKits);
  if (initialKits !== seen) {
    setSeen(initialKits);
    setKitsState(initialKits);
  }
  // Every change also refreshes the page, so the print bar above shows
  // "Changed after print — reprint" at once.
  const setKits = (next: KitView[]) => {
    setKitsState(next);
    router.refresh();
  };
  if (kits.length === 0) return null;

  const adapter: KitAdapter = {
    async upload(kit, file, name, target, onProgress) {
      const form = new FormData();
      form.append("file", file, name);
      form.append("slot", target.slot);
      form.append("position", String(target.position));
      const data = await uploadWithProgress<{ kits: KitView[] }>(`/api/print/kits/${kit.key}/photos`, form, onProgress);
      setKits(data.kits);
    },
    async move(kit, from, to) {
      setKits(await call(`/api/print/kits/${kit.key}/move`, "POST", { from, to }));
    },
    async crop(_kit, photo, crop) {
      setKits(await call(`/api/print/photos/${photo.id}`, "PATCH", { crop }));
    },
    async remove(_kit, photo) {
      setKits(await call(`/api/print/photos/${photo.id}`, "DELETE"));
    },
    async setCard(kit, slot, choice) {
      setKits(await call(`/api/print/kits/${kit.key}/cards/${slot}`, "PUT", choice));
    },
    async clearCard(kit, slot) {
      setKits(await call(`/api/print/kits/${kit.key}/cards/${slot}`, "DELETE"));
    },
    deleteKit: canDeleteKit
      ? async (kit) => {
          if (!confirm("Delete this kit with its photos and cards?")) return;
          setKits(await call(`/api/print/kits/${kit.key}`, "DELETE"));
          setTab(0);
        }
      : undefined,
  };

  const current = kits[Math.min(tab, kits.length - 1)];
  return (
    <Card>
      <CardHeader>
        <CardTitle>ছবি ও কার্ড / Photos &amp; cards</CardTitle>
        <CardDescription>
          {locked
            ? "অর্ডার প্যাক হয়ে গেছে — শুধু দেখা যাবে / The order is packed — view only (Admin/Manager can still change)."
            : canEdit
              ? "Customer photos and wishing cards for printing. Changes save at once."
              : "View only."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {print && (
          <PrintBar
            orderId={print.orderId}
            orderNo={print.orderNo}
            print={print.status}
            canPrint={print.canPrint}
            borderless={print.borderless}
          />
        )}
        {kits.length > 1 && (
          <div className="flex gap-1 overflow-x-auto border-b">
            {kits.map((k, i) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setTab(i)}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-1.5 text-xs font-medium ${
                  i === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                }`}
              >
                Kit {i + 1}
                {k.orphaned ? " (removed)" : ""} · {k.progress.state === "READY" ? "✓" : `${k.progress.photos}/${k.progress.photosNeeded}`}
              </button>
            ))}
          </div>
        )}
        <KitPanel kit={toPanelKit(current)} sizes={sizes} canEdit={canEdit} adapter={adapter} key={current.id} />
      </CardContent>
    </Card>
  );
}
