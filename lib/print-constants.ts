// PHOTO_PRINT.md — client-safe gift-print constants (no Prisma import), shared
// by the Settings → Gift print pages, the order form and the server.

export const CARD_LANGUAGES = ["BN", "EN", "MIXED"] as const;
export type CardLanguageValue = (typeof CARD_LANGUAGES)[number];

export const CARD_LANGUAGE_LABELS: Record<CardLanguageValue, string> = {
  BN: "বাংলা / Bangla",
  EN: "English",
  MIXED: "মিশ্র / Mixed",
};

/** {to} / {from} — the optional name slots of a card message (PP-3). */
export const NAME_SLOT_RE = /\{(to|from)\}/;

export function hasNameSlots(text: string): boolean {
  return NAME_SLOT_RE.test(text);
}
