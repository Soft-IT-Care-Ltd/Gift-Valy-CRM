import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AuthzError } from "./authz";
import {
  kitProgress,
  normalizePrintKit,
  type KitCardView,
  type KitPhotoView,
  type KitView,
  type PrintKitSpec,
  type PrintKitStatusValue,
} from "./print-kit";
import { cropFocus, normalizeCrop } from "./print-crop";
import { previewName } from "./print-photos";
import type { CardSlot, PhotoSlot } from "./print-layouts";

// ============ PHOTO_PRINT.md PP-4 — reading kits for the screen ============

const PRINT_URL = "/uploads/print/";

export const kitViewInclude = {
  product: { select: { name: true } },
  photos: { orderBy: [{ slot: "asc" }, { position: "asc" }] },
  cards: { orderBy: { slot: "asc" }, include: { design: { select: { name: true } } } },
} satisfies Prisma.OrderPrintKitInclude;

type KitRow = Prisma.OrderPrintKitGetPayload<{ include: typeof kitViewInclude }>;

/** The kit's slot plan: which photo slots / positions and cards it needs. */
export function kitSpec(kit: { spec: unknown }): PrintKitSpec {
  return normalizePrintKit(kit.spec) ?? { photos: { PHOTO_L: 0, PHOTO_S: 0 }, cards: [] };
}

export function photoView(p: {
  id: number;
  slot: string | null;
  position: number | null;
  originalPath: string;
  crop: unknown;
  srcWidth: number;
  srcHeight: number;
  lowRes: boolean;
}): KitPhotoView {
  return {
    id: p.id,
    slot: (p.slot ?? "PHOTO_L") as PhotoSlot,
    position: p.position ?? 0,
    url: PRINT_URL + previewName(p.originalPath),
    crop: normalizeCrop(p.crop),
    focus: cropFocus(p.crop),
    srcWidth: p.srcWidth,
    srcHeight: p.srcHeight,
    lowRes: p.lowRes,
  };
}

function cardView(c: KitRow["cards"][number]): KitCardView {
  return {
    slot: c.slot as CardSlot,
    designId: c.designId,
    designName: c.design.name,
    messageId: c.messageId,
    text: c.text,
    toName: c.toName,
    fromName: c.fromName,
    renderUrl: c.renderPath ? PRINT_URL + c.renderPath : null,
    fontPt: c.fontPt == null ? null : Number(c.fontPt),
  };
}

/** "Customize Chocolate Box — Kit 1 of 2 · Probashi Combo" for every kit. */
async function kitLabels(kits: KitRow[]): Promise<Map<number, string>> {
  const pkgIds = new Set<number>();
  for (const k of kits) {
    const m = /^K(\d+)\./.exec(k.sourceKey);
    if (m) pkgIds.add(Number(m[1]));
  }
  const pkgs = pkgIds.size
    ? await prisma.package.findMany({ where: { id: { in: [...pkgIds] } }, select: { id: true, name: true } })
    : [];
  const pkgName = new Map(pkgs.map((p) => [p.id, p.name]));
  const live = kits.filter((k) => !k.orphanedAt);
  const labels = new Map<number, string>();
  for (const k of kits) {
    const root = /^K(\d+)\./.exec(k.sourceKey);
    const via = root ? ` · ${pkgName.get(Number(root[1])) ?? "package"}` : "";
    const n = live.indexOf(k) + 1;
    labels.set(
      k.id,
      k.orphanedAt
        ? `${k.product.name} — line removed`
        : `${k.product.name} — Kit ${n} of ${live.length}${via}`
    );
  }
  return labels;
}

export async function loadKitViews(orderId: number): Promise<KitView[]> {
  const kits = await prisma.orderPrintKit.findMany({
    where: { orderId },
    orderBy: { id: "asc" },
    include: kitViewInclude,
  });
  const labels = await kitLabels(kits);
  return kits.map((k) => {
    const spec = kitSpec(k);
    return {
      id: k.id,
      sourceKey: k.sourceKey,
      label: labels.get(k.id) ?? k.product.name,
      spec,
      status: k.status as PrintKitStatusValue,
      progress: kitProgress(spec, k.photoCount, k.cardCount),
      orphaned: !!k.orphanedAt,
      printedAt: k.printedAt ? k.printedAt.toISOString() : null,
      photos: k.photos.map(photoView),
      cards: k.cards.map(cardView),
    };
  });
}

/** The first empty photo slot of a kit: big 1…L, then small 1…S. */
export function firstFreeSlot(
  spec: PrintKitSpec,
  taken: { slot: string | null; position: number | null }[]
): { slot: PhotoSlot; position: number } | null {
  const used = new Set(taken.map((t) => `${t.slot}:${t.position}`));
  for (const slot of ["PHOTO_L", "PHOTO_S"] as PhotoSlot[]) {
    for (let p = 1; p <= spec.photos[slot]; p++) {
      if (!used.has(`${slot}:${p}`)) return { slot, position: p };
    }
  }
  return null;
}

export function assertSlotInSpec(spec: PrintKitSpec, slot: PhotoSlot, position: number) {
  if (!Number.isInteger(position) || position < 1 || position > spec.photos[slot]) {
    throw new AuthzError(400, "That photo slot is not part of this kit");
  }
}
