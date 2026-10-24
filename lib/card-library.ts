import { z } from "zod";
import type { CardDesign, CardMessage } from "@prisma/client";
import { CARD_LANGUAGES, hasNameSlots } from "./print-constants";
import { CARD_TEXT_MAX } from "./print-card-text";
import { normalizeTextBox, fontDisplayName, type CardDesignForRender } from "./print-card";

// PHOTO_PRINT.md PP-3 — the card library (designs + messages): the API
// schemas and wire shapes shared by /api/print/card-designs and
// /api/print/card-messages. Designs and messages are managed with
// print.settings (Admin + Manager); every print role may read the active ones
// (the SE picks from them on the order, PP-4).

export const PRINT_LIBRARY_READ = ["print.settings", "print.edit", "print.print"];

const pct = z.number().min(0).max(100);

export const cardDesignSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    slot: z.enum(["CARD_1", "CARD_2"]),
    textBox: z.object({ x: pct, y: pct, w: pct.min(5), h: pct.min(5) }),
    textColor: z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, "Colour must be like #be185d"),
    align: z.enum(["LEFT", "CENTER", "RIGHT"]),
    fontPath: z.string().trim().min(1).nullable(),
    maxFontPt: z.number().min(6).max(48),
    minFontPt: z.number().min(5).max(48),
    isActive: z.boolean(),
  })
  .refine((d) => d.minFontPt <= d.maxFontPt, {
    message: "Minimum text size cannot be larger than the maximum",
    path: ["minFontPt"],
  })
  .refine((d) => d.textBox.x + d.textBox.w <= 100.01 && d.textBox.y + d.textBox.h <= 100.01, {
    message: "The text area must stay inside the card",
    path: ["textBox"],
  });

export type CardDesignInput = z.infer<typeof cardDesignSchema>;

export function serializeCardDesign(d: CardDesign) {
  return {
    id: d.id,
    name: d.name,
    slot: d.slot as "CARD_1" | "CARD_2",
    backgroundPath: d.backgroundPath,
    textBox: normalizeTextBox(d.textBox),
    textColor: d.textColor,
    align: d.align,
    fontPath: d.fontPath,
    fontName: fontDisplayName(d.fontPath),
    maxFontPt: Number(d.maxFontPt),
    minFontPt: Number(d.minFontPt),
    isActive: d.isActive,
  };
}

export type CardDesignRow = ReturnType<typeof serializeCardDesign>;

export function designForRender(d: Omit<CardDesignRow, "id" | "name" | "slot" | "isActive" | "fontName">): CardDesignForRender {
  return {
    backgroundPath: d.backgroundPath,
    textBox: normalizeTextBox(d.textBox),
    textColor: d.textColor,
    align: d.align,
    fontPath: d.fontPath,
    maxFontPt: d.maxFontPt,
    minFontPt: d.minFontPt,
  };
}

export const cardMessageSchema = z.object({
  occasion: z.string().trim().min(1).max(60),
  language: z.enum(CARD_LANGUAGES),
  text: z.string().trim().min(1).max(CARD_TEXT_MAX),
  isActive: z.boolean(),
});

export function serializeCardMessage(m: CardMessage) {
  return {
    id: m.id,
    occasion: m.occasion,
    language: m.language,
    text: m.text,
    hasNameSlots: hasNameSlots(m.text),
    sortOrder: m.sortOrder,
    isActive: m.isActive,
  };
}

export type CardMessageRow = ReturnType<typeof serializeCardMessage>;
