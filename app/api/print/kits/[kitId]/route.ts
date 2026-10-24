import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthzError, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { deletePrintFiles } from "@/lib/file-storage";
import { printReadableOrder, requirePrintCtx } from "@/lib/print-access";
import { previewName } from "@/lib/print-photos";
import { loadKitViews } from "@/lib/print-kit-ops";

type Params = { params: Promise<{ kitId: string }> };

// PHOTO_PRINT.md PP-4 — delete a kit whose order line was removed ("Line
// removed") together with its photos and cards. Admin/Manager (orders.edit)
// only; a kit that still belongs to a line can't be deleted.
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const ctx = await requirePrintCtx();
    if (!ctx.permissions.includes("orders.edit") || !ctx.permissions.includes("print.edit")) {
      throw new AuthzError(403, "Only Admin/Manager can delete a kit");
    }
    const kit = await prisma.orderPrintKit.findUnique({
      where: { id: Number((await params).kitId) },
      include: { photos: true, cards: true },
    });
    if (!kit || !(await printReadableOrder(ctx, kit.orderId))) {
      return NextResponse.json({ error: "Kit not found" }, { status: 404 });
    }
    if (!kit.orphanedAt) throw new AuthzError(400, "This kit still belongs to an order line");
    await prisma.orderPrintKit.delete({ where: { id: kit.id } });
    await deletePrintFiles([
      ...kit.photos.flatMap((p) => [p.originalPath, previewName(p.originalPath), p.printPath]),
      ...kit.cards.map((c) => c.renderPath),
    ]);
    await logAudit({
      userId: ctx.session.user.id,
      action: "print.kit.delete",
      entity: "order_print_kits",
      entityId: kit.id,
      before: { orderId: kit.orderId, sourceKey: kit.sourceKey, photos: kit.photos.length, cards: kit.cards.length },
    });
    return NextResponse.json({ kits: await loadKitViews(kit.orderId) });
  } catch (e) {
    return apiError(e);
  }
}
