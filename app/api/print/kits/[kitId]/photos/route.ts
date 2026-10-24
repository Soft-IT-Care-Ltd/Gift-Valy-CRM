import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { AuthzError, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { deletePrintFiles } from "@/lib/file-storage";
import { getPrintSettings } from "@/lib/settings";
import { requireEditableKit, requirePrintCtx } from "@/lib/print-access";
import { PhotoError, makePrintFile, previewName, storeOriginal } from "@/lib/print-photos";
import { assertSlotInSpec, firstFreeSlot, kitSpec, loadKitViews } from "@/lib/print-kit-ops";
import { refreshKit } from "@/lib/print-kits";
import { warmPrintPdf } from "@/lib/print-pdf-build";
import type { PhotoSlot } from "@/lib/print-layouts";

type Params = { params: Promise<{ kitId: string }> };

// PHOTO_PRINT.md PP-4 — add a photo to a saved order's kit: into the given
// slot (replacing the photo there) or the first empty one. The print file is
// made at once. Returns the order's kits.
export async function POST(req: Request, { params }: Params) {
  try {
    const ctx = await requirePrintCtx();
    const { kit, order } = await requireEditableKit(ctx, Number((await params).kitId));
    const spec = kitSpec(kit);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const existing = await prisma.orderPrintPhoto.findMany({
      where: { kitId: kit.id },
      select: { id: true, slot: true, position: true, originalPath: true, printPath: true },
    });
    let target: { slot: PhotoSlot; position: number } | null;
    const askedSlot = form.get("slot");
    if (askedSlot) {
      const slot = String(askedSlot) as PhotoSlot;
      if (slot !== "PHOTO_L" && slot !== "PHOTO_S") throw new AuthzError(400, "Unknown slot");
      const position = Number(form.get("position"));
      assertSlotInSpec(spec, slot, position);
      target = { slot, position };
    } else {
      target = firstFreeSlot(spec, existing);
      if (!target) {
        throw new AuthzError(400, "সব ছবি দেওয়া হয়ে গেছে / All photo slots are full — replace or delete one first");
      }
    }
    const replaced = existing.find((p) => p.slot === target!.slot && p.position === target!.position);

    const stored = await storeOriginal(Buffer.from(await file.arrayBuffer()));
    const { sizes } = await getPrintSettings();
    const print = await makePrintFile(stored, target.slot, sizes);
    const photo = await prisma.$transaction(async (tx) => {
      if (replaced) await tx.orderPrintPhoto.delete({ where: { id: replaced.id } });
      const created = await tx.orderPrintPhoto.create({
        data: {
          ...stored,
          crop: stored.crop as object,
          kitId: kit.id,
          slot: target!.slot,
          position: target!.position,
          printPath: print.printPath,
          lowRes: print.lowRes,
          uploadedBy: ctx.session.user.id,
        },
      });
      await refreshKit(tx, kit.id, { changed: true });
      return created;
    });
    if (replaced) {
      await deletePrintFiles([replaced.originalPath, previewName(replaced.originalPath), replaced.printPath]);
    }
    await logAudit({
      userId: ctx.session.user.id,
      action: replaced ? "print.photo.replace" : "print.photo.upload",
      entity: "order_print_kits",
      entityId: kit.id,
      before: replaced ? { photoId: replaced.id } : undefined,
      after: {
        orderNo: order.orderNo,
        photoId: photo.id,
        slot: target.slot,
        position: target.position,
        srcWidth: stored.srcWidth,
        srcHeight: stored.srcHeight,
        lowRes: print.lowRes,
      },
    });
    after(() => warmPrintPdf(order.id)); // PP-6: the PDF is ready before Packing clicks Print
    return NextResponse.json({ kits: await loadKitViews(order.id) }, { status: 201 });
  } catch (e) {
    if (e instanceof PhotoError) return NextResponse.json({ error: e.message }, { status: 400 });
    return apiError(e);
  }
}
