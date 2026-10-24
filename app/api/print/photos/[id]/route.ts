import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { deletePrintFiles } from "@/lib/file-storage";
import { getPrintSettings } from "@/lib/settings";
import { requireEditableKit, requirePrintCtx } from "@/lib/print-access";
import { makePrintFile, previewName } from "@/lib/print-photos";
import { normalizeCrop, storedCrop, CROP_MAX_ZOOM } from "@/lib/print-crop";
import { loadKitViews } from "@/lib/print-kit-ops";
import { refreshKit } from "@/lib/print-kits";
import type { PhotoSlot } from "@/lib/print-layouts";

type Params = { params: Promise<{ id: string }> };

async function attachedPhoto(id: number) {
  const photo = await prisma.orderPrintPhoto.findUnique({ where: { id } });
  if (!photo || photo.kitId == null) return null;
  return photo;
}

const cropSchema = z.object({
  crop: z.object({
    cx: z.number().min(0).max(1),
    cy: z.number().min(0).max(1),
    zoom: z.number().min(1).max(CROP_MAX_ZOOM),
  }),
});

// PHOTO_PRINT.md PP-4 — save a new crop: the print file is re-made.
export async function PATCH(req: Request, { params }: Params) {
  try {
    const ctx = await requirePrintCtx();
    const photo = await attachedPhoto(Number((await params).id));
    if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    const { kit, order } = await requireEditableKit(ctx, photo.kitId!);
    const crop = normalizeCrop(cropSchema.parse(await req.json()).crop);
    const { sizes } = await getPrintSettings();
    const print = await makePrintFile({ ...photo, crop }, photo.slot as PhotoSlot, sizes);
    await prisma.$transaction(async (tx) => {
      await tx.orderPrintPhoto.update({
        where: { id: photo.id },
        data: { crop: storedCrop(crop, photo.crop) as object, printPath: print.printPath, lowRes: print.lowRes },
      });
      await refreshKit(tx, kit.id, { changed: true });
    });
    if (photo.printPath !== print.printPath) await deletePrintFiles([photo.printPath]);
    await logAudit({
      userId: ctx.session.user.id,
      action: "print.photo.crop",
      entity: "order_print_kits",
      entityId: kit.id,
      before: { photoId: photo.id, crop: photo.crop },
      after: { orderNo: order.orderNo, photoId: photo.id, crop, lowRes: print.lowRes },
    });
    return NextResponse.json({ kits: await loadKitViews(order.id) });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const ctx = await requirePrintCtx();
    const photo = await attachedPhoto(Number((await params).id));
    if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    const { kit, order } = await requireEditableKit(ctx, photo.kitId!);
    await prisma.$transaction(async (tx) => {
      await tx.orderPrintPhoto.delete({ where: { id: photo.id } });
      await refreshKit(tx, kit.id, { changed: true });
    });
    await deletePrintFiles([photo.originalPath, previewName(photo.originalPath), photo.printPath]);
    await logAudit({
      userId: ctx.session.user.id,
      action: "print.photo.delete",
      entity: "order_print_kits",
      entityId: kit.id,
      before: { orderNo: order.orderNo, photoId: photo.id, slot: photo.slot, position: photo.position },
    });
    return NextResponse.json({ kits: await loadKitViews(order.id) });
  } catch (e) {
    return apiError(e);
  }
}
