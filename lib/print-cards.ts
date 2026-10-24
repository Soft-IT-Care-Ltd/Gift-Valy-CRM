import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "./db";
import { AuthzError } from "./authz";
import { savePrintFile } from "./file-storage";
import { renderCard } from "./print-card";
import { CARD_TEXT_MAX, cardLines } from "./print-card-text";
import { designForRender, serializeCardDesign } from "./card-library";
import type { CardSlot, PrintSizes } from "./print-layouts";
import type { PrintKitSpec } from "./print-kit";

// ============ PHOTO_PRINT.md PP-4 — choosing a wishing card ============
// design → (occasion →) library message with optional names, or the SE's own
// words. The library text is snapshotted onto the card, so editing the library
// never changes an order. The card is rendered here (the print renderer) and
// REFUSED when even the smallest size overflows the design's text area.

export const cardChoiceSchema = z
  .object({
    designId: z.number().int().positive(),
    messageId: z.number().int().positive().nullable(),
    /** The custom message (messageId null). Ignored for a library message. */
    text: z.string().trim().max(CARD_TEXT_MAX).optional(),
    toName: z.string().trim().max(60).nullable().optional(),
    fromName: z.string().trim().max(60).nullable().optional(),
  })
  .refine((c) => c.messageId != null || !!c.text, {
    message: "Pick a message or type the customer's own message",
    path: ["text"],
  });

export type CardChoice = z.infer<typeof cardChoiceSchema>;

export interface PreparedCard {
  designId: number;
  messageId: number | null;
  text: string;
  toName: string | null;
  fromName: string | null;
  renderPath: string;
  fontPt: number;
}

/** Validates a card choice for `slot`, renders it and writes the PNG. */
export async function prepareCard(
  slot: CardSlot,
  choice: CardChoice,
  spec: PrintKitSpec,
  sizes: PrintSizes
): Promise<PreparedCard> {
  if (!spec.cards.includes(slot)) throw new AuthzError(400, "This kit has no such card");
  const design = await prisma.cardDesign.findUnique({ where: { id: choice.designId } });
  if (!design || !design.isActive || design.slot !== slot) {
    throw new AuthzError(400, "Pick an active design for this card");
  }
  let text: string;
  let toName: string | null = null;
  let fromName: string | null = null;
  if (choice.messageId != null) {
    const message = await prisma.cardMessage.findUnique({ where: { id: choice.messageId } });
    if (!message || !message.isActive) throw new AuthzError(400, "That message is no longer available");
    text = message.text;
    toName = choice.toName?.trim() || null;
    fromName = choice.fromName?.trim() || null;
  } else {
    text = choice.text!.trim();
  }
  const lines = cardLines(text, { to: toName, from: fromName });
  if (lines.length === 0) throw new AuthzError(400, "The card would be empty");
  const card = await renderCard(designForRender(serializeCardDesign(design)), sizes[slot], lines);
  if (!card.fits) {
    throw new AuthzError(
      400,
      "মেসেজটা বড় — একটু ছোট করুন / The message is too long for this card — please shorten it"
    );
  }
  const renderPath = await savePrintFile(`card-${randomUUID()}.png`, card.png);
  return { designId: design.id, messageId: choice.messageId, text, toName, fromName, renderPath, fontPt: card.fontPt };
}
