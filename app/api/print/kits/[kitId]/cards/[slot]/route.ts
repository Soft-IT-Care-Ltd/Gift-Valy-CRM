import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { AuthzError, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { deletePrintFiles } from "@/lib/file-storage";
import { getPrintSettings } from "@/lib/settings";
import { requireEditableKit, requirePrintCtx } from "@/lib/print-access";
import { cardChoiceSchema, prepareCard } from "@/lib/print-cards";
import { kitSpec, loadKitViews } from "@/lib/print-kit-ops";
import { refreshKit } from "@/lib/print-kits";
import { warmPrintPdf } from "@/lib/print-pdf-build";
import type { CardSlot } from "@/lib/print-layouts";

type Params = { params: Promise<{ kitId: string; slot: string }> };

async function target(params: Params["params"]) {
  const p = await params;
  const slot = p.slot as CardSlot;
  if (slot !== "CARD_1" && slot !== "CARD_2") throw new AuthzError(400, "Unknown card");
  return { kitId: Number(p.kitId), slot };
}

// PHOTO_PRINT.md PP-4 — set one card of a kit (design + message or custom
// text + optional names). Rendered and checked here; refused when too long.
export async function PUT(req: Request, { params }: Params) {
  try {
    const ctx = await requirePrintCtx();
    const { kitId, slot } = await target(params);
    const { kit, order } = await requireEditableKit(ctx, kitId);
    const choice = cardChoiceSchema.parse(await req.json());
    const { sizes } = await getPrintSettings();
    const card = await prepareCard(slot, choice, kitSpec(kit), sizes);
    const before = await prisma.orderPrintCard.findUnique({ where: { kitId_slot: { kitId, slot } } });
    await prisma.$transaction(async (tx) => {
      await tx.orderPrintCard.upsert({
        where: { kitId_slot: { kitId, slot } },
        create: { ...card, kitId, slot, updatedBy: ctx.session.user.id },
        update: { ...card, updatedBy: ctx.session.user.id },
      });
      await refreshKit(tx, kitId, { changed: true });
    });
    if (before?.renderPath) await deletePrintFiles([before.renderPath]);
    await logAudit({
      userId: ctx.session.user.id,
      action: "print.card.set",
      entity: "order_print_kits",
      entityId: kitId,
      before: before
        ? { slot, designId: before.designId, messageId: before.messageId, text: before.text, toName: before.toName, fromName: before.fromName }
        : undefined,
      after: { orderNo: order.orderNo, slot, designId: card.designId, messageId: card.messageId, text: card.text, toName: card.toName, fromName: card.fromName, fontPt: card.fontPt },
    });
    after(() => warmPrintPdf(order.id)); // PP-6: the PDF is ready before Packing clicks Print
    return NextResponse.json({ kits: await loadKitViews(order.id) });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const ctx = await requirePrintCtx();
    const { kitId, slot } = await target(params);
    const { order } = await requireEditableKit(ctx, kitId);
    const before = await prisma.orderPrintCard.findUnique({ where: { kitId_slot: { kitId, slot } } });
    if (before) {
      await prisma.$transaction(async (tx) => {
        await tx.orderPrintCard.delete({ where: { id: before.id } });
        await refreshKit(tx, kitId, { changed: true });
      });
      await deletePrintFiles([before.renderPath]);
      await logAudit({
        userId: ctx.session.user.id,
        action: "print.card.clear",
        entity: "order_print_kits",
        entityId: kitId,
        before: { orderNo: order.orderNo, slot, designId: before.designId, messageId: before.messageId, text: before.text },
      });
    }
    after(() => warmPrintPdf(order.id)); // PP-6: the PDF is ready before Packing clicks Print
    return NextResponse.json({ kits: await loadKitViews(order.id) });
  } catch (e) {
    return apiError(e);
  }
}
