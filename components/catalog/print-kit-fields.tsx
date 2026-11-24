"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_PRINT_KIT,
  PRINT_KIT_MAX,
  describePrintKit,
  type PrintKitSpec,
} from "@/lib/print-kit";

// PHOTO_PRINT PP-2 — "Needs customer photos / cards" on the product AND the
// package form: the switch, big/small photo counts and the two cards.

export function usePrintKitForm() {
  const [on, setOn] = useState(false);
  const [big, setBig] = useState(String(DEFAULT_PRINT_KIT.photos.PHOTO_L));
  const [small, setSmall] = useState(String(DEFAULT_PRINT_KIT.photos.PHOTO_S));
  const [card1, setCard1] = useState(true);
  const [card2, setCard2] = useState(true);

  /** Loads a saved kit (null = off) into the form. */
  function load(kit: PrintKitSpec | null) {
    const k = kit ?? DEFAULT_PRINT_KIT;
    setOn(kit != null);
    setBig(String(k.photos.PHOTO_L));
    setSmall(String(k.photos.PHOTO_S));
    setCard1(k.cards.includes("CARD_1"));
    setCard2(k.cards.includes("CARD_2"));
  }

  const count = (v: string, max: number) => Math.min(max, Math.max(0, Math.floor(Number(v) || 0)));
  /** What to save: the kit, or null when the switch is off. */
  const payload: PrintKitSpec | null = on
    ? {
        photos: {
          PHOTO_L: count(big, PRINT_KIT_MAX.PHOTO_L),
          PHOTO_S: count(small, PRINT_KIT_MAX.PHOTO_S),
        },
        cards: [...(card1 ? (["CARD_1"] as const) : []), ...(card2 ? (["CARD_2"] as const) : [])],
      }
    : null;

  return { on, setOn, big, setBig, small, setSmall, card1, setCard1, card2, setCard2, load, payload };
}

export type PrintKitForm = ReturnType<typeof usePrintKitForm>;

export function PrintKitFields({ form, hint }: { form: PrintKitForm; hint: string }) {
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label>Needs customer photos / cards</Label>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Switch checked={form.on} onCheckedChange={form.setOn} />
      </div>
      {form.on && (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1">
            <Label htmlFor="kitBig">Big photos (max {PRINT_KIT_MAX.PHOTO_L})</Label>
            <Input
              id="kitBig"
              type="number"
              min={0}
              max={PRINT_KIT_MAX.PHOTO_L}
              value={form.big}
              onChange={(e) => form.setBig(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="kitSmall">Small photos (max {PRINT_KIT_MAX.PHOTO_S})</Label>
            <Input
              id="kitSmall"
              type="number"
              min={0}
              max={PRINT_KIT_MAX.PHOTO_S}
              value={form.small}
              onChange={(e) => form.setSmall(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.card1} onCheckedChange={form.setCard1} />
            Card 1 (large)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.card2} onCheckedChange={form.setCard2} />
            Card 2 (small)
          </label>
          {form.payload && (
            <p className="col-span-2 text-xs text-muted-foreground">
              Per unit: {describePrintKit(form.payload) || "nothing — the kit is off"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
