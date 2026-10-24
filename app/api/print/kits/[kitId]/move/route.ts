import { NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { deletePrintFiles } from "@/lib/file-storage";
import { getPrintSettings } from "@/lib/settings";
import { requireEditableKit, requirePrintCtx } from "@/lib/print-access";
import { makePrintFile } from "@/lib/print-photos";
import { normalizeCrop } from "@/lib/print-crop";
import { assertSlotInSpec, kitSpec, loadKitViews } from "@/lib/print-kit-ops";
import { refreshKit } from "@/lib/print-kits";
import { warmPrintPdf } from "@/lib/print-pdf-build";
import type { PhotoSlot } from "@/lib/print-layouts";

type Params = { params: Promise<{ kitId: string }> };

const at = z.object({ slot: z.enum(["PHOTO_L", "PHOTO_S"]), position: z.number().int().min(1) });
const schema = z.object({ from: at, to: at });

// PHOTO_PRINT.md PP-4 — move a photo to another slot of the same kit (big ↔
// small included): into an empty slot, or swapping with the photo there. A
// photo that changes size gets a new print file (same crop focus).
export async function POST(req: Request, { params }: Params) {
  try {
    const ctx = await requirePrintCtx();
    const { kit, order } = await requireEditableKit(ctx, Number((await params).kitId));
    const spec = kitSpec(kit);
    const { from, to } = schema.parse(await req.json());
    assertSlotInSpec(spec, from.slot, from.position);
    assertSlotInSpec(spec, to.slot, to.position);
    const photos = await prisma.orderPrintPhoto.findMany({ where: { kitId: kit.id } });
    const a = photos.find((p) => p.slot === from.slot && p.position === from.position);
    if (!a) return NextResponse.json({ error: "No photo in that slot" }, { status: 400 });
    const b = photos.find((p) => p.slot === to.slot && p.position === to.position);
    if (a === b) return NextResponse.json({ kits: await loadKitViews(order.id) });

    const { sizes } = await getPrintSettings();
    const remake = async (p: typeof a, slot: PhotoSlot) =>
      p.slot === slot
        ? { printPath: p.printPath, lowRes: p.lowRes }
        : makePrintFile({ ...p, crop: normalizeCrop(p.crop) }, slot, sizes);
    const aPrint = await remake(a, to.slot);
    const bPrint = b ? await remake(b, from.slot) : null;

    await prisma.$transaction(async (tx) => {
      // Park A first: (kit, slot, position) is unique.
      await tx.orderPrintPhoto.update({ where: { id: a.id }, data: { position: -a.id } });
      if (b) {
        await tx.orderPrintPhoto.update({
          where: { id: b.id },
          data: { slot: from.slot, position: from.position, ...bPrint },
        });
      }
      await tx.orderPrintPhoto.update({
        where: { id: a.id },
        data: { slot: to.slot, position: to.position, ...aPrint },
      });
      await refreshKit(tx, kit.id, { changed: true });
    });
    const stale = [
      aPrint.printPath !== a.printPath ? a.printPath : null,
      b && bPrint && bPrint.printPath !== b.printPath ? b.printPath : null,
    ];
    await deletePrintFiles(stale);
    await logAudit({
      userId: ctx.session.user.id,
      action: "print.photo.move",
      entity: "order_print_kits",
      entityId: kit.id,
      after: { orderNo: order.orderNo, photoId: a.id, from, to, swappedWith: b?.id ?? null },
    });
    after(() => warmPrintPdf(order.id)); // PP-6: the PDF is ready before Packing clicks Print
    return NextResponse.json({ kits: await loadKitViews(order.id) });
  } catch (e) {
    return apiError(e);
  }
}
