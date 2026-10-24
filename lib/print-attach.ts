import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db";
import { AuthzError } from "./authz";
import { CROP_MAX_ZOOM, normalizeCrop, storedCrop } from "./print-crop";
import { makePrintFile } from "./print-photos";
import { cardChoiceSchema, prepareCard, type PreparedCard } from "./print-cards";
import { refreshKit } from "./print-kits";
import { kitSpec } from "./print-kit-ops";
import type { CardSlot, PhotoSlot, PrintSizes } from "./print-layouts";

// ============ PHOTO_PRINT.md PP-4 — the new order form's photos & cards ============
//
// On the new-order form photos are uploaded "staged" (no order yet) and the
// cards are chosen in the browser. Saving the order sends them as printKits,
// keyed by the kit source keys from /api/print/kits-preview. Before the
// order transaction: check the staged photos are this person's, make every
// print file and render every card (refusing a card that is too long). Inside
// it, after syncPrintKits: attach them to the kits just created.

const at = { slot: z.enum(["PHOTO_L", "PHOTO_S"]), position: z.number().int().min(1).max(20) };

export const printKitsPayloadSchema = z
  .array(
    z.object({
      sourceKey: z.string().min(1).max(300),
      photos: z
        .array(
          z.object({
            id: z.number().int().positive(),
            ...at,
            crop: z.object({
              cx: z.number().min(0).max(1),
              cy: z.number().min(0).max(1),
              zoom: z.number().min(1).max(CROP_MAX_ZOOM),
            }),
          })
        )
        .max(30),
      cards: z
        .array(z.object({ slot: z.enum(["CARD_1", "CARD_2"]), choice: cardChoiceSchema }))
        .max(2),
    })
  )
  .max(100);

export type PrintKitsPayload = z.infer<typeof printKitsPayloadSchema>;

interface PreparedPhoto {
  id: number;
  slot: PhotoSlot;
  position: number;
  crop: ReturnType<typeof storedCrop>;
  printPath: string;
  lowRes: boolean;
}

export interface PreparedPrint {
  kits: {
    sourceKey: string;
    photos: PreparedPhoto[];
    cards: { slot: CardSlot; card: PreparedCard }[];
  }[];
}

/** Everything slow or refusable, BEFORE the order transaction. */
export async function preparePrintAttach(
  userId: number,
  payload: PrintKitsPayload,
  sizes: PrintSizes
): Promise<PreparedPrint> {
  const ids = payload.flatMap((k) => k.photos.map((p) => p.id));
  if (new Set(ids).size !== ids.length) throw new AuthzError(400, "A photo is used twice");
  const staged = await prisma.orderPrintPhoto.findMany({
    where: { id: { in: ids }, kitId: null, stagedBy: userId },
  });
  if (staged.length !== ids.length) {
    throw new AuthzError(
      400,
      "কিছু ছবি আর পাওয়া যাচ্ছে না — আবার আপলোড করুন / Some photos are no longer available — please upload them again"
    );
  }
  const byId = new Map(staged.map((p) => [p.id, p]));
  const anyCards = { photos: { PHOTO_L: 0, PHOTO_S: 0 }, cards: ["CARD_1", "CARD_2"] as CardSlot[] };
  const kits: PreparedPrint["kits"] = [];
  for (const k of payload) {
    const places = k.photos.map((p) => `${p.slot}:${p.position}`);
    if (new Set(places).size !== places.length) throw new AuthzError(400, "Two photos are in the same slot");
    const photos: PreparedPhoto[] = [];
    for (const p of k.photos) {
      const row = byId.get(p.id)!;
      const crop = normalizeCrop(p.crop);
      const print = await makePrintFile({ ...row, crop }, p.slot, sizes);
      photos.push({ id: p.id, slot: p.slot, position: p.position, crop: storedCrop(crop, row.crop), ...print });
    }
    const cards = [];
    for (const c of k.cards) cards.push({ slot: c.slot, card: await prepareCard(c.slot, c.choice, anyCards, sizes) });
    kits.push({ sourceKey: k.sourceKey, photos, cards });
  }
  return { kits };
}

/** Inside the order transaction, after syncPrintKits. Content for a key the
 *  order has no kit for is left staged (the nightly cleanup drops it). */
export async function attachPrint(
  tx: Prisma.TransactionClient,
  orderId: number,
  prepared: PreparedPrint,
  userId: number
): Promise<{ photos: number; cards: number }> {
  const kits = await tx.orderPrintKit.findMany({ where: { orderId }, select: { id: true, sourceKey: true, spec: true } });
  const byKey = new Map(kits.map((k) => [k.sourceKey, k]));
  let photos = 0;
  let cards = 0;
  for (const k of prepared.kits) {
    const kit = byKey.get(k.sourceKey);
    if (!kit) continue;
    const spec = kitSpec(kit);
    for (const p of k.photos) {
      if (p.position > spec.photos[p.slot]) continue;
      await tx.orderPrintPhoto.update({
        where: { id: p.id },
        data: {
          kitId: kit.id,
          slot: p.slot,
          position: p.position,
          crop: p.crop as object,
          printPath: p.printPath,
          lowRes: p.lowRes,
          stageToken: null,
          stagedBy: null,
        },
      });
      photos++;
    }
    for (const c of k.cards) {
      if (!spec.cards.includes(c.slot)) continue;
      await tx.orderPrintCard.create({ data: { ...c.card, kitId: kit.id, slot: c.slot, updatedBy: userId } });
      cards++;
    }
    await refreshKit(tx, kit.id);
  }
  return { photos, cards };
}
