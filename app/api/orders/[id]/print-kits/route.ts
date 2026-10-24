import { NextResponse } from "next/server";
import { apiError } from "@/lib/authz";
import { canEditPrintAt, printReadableOrder, requirePrintCtx } from "@/lib/print-access";
import { loadKitViews } from "@/lib/print-kit-ops";

type Params = { params: Promise<{ id: string }> };

// PHOTO_PRINT.md PP-4 — the order's kits with their photos and cards.
// print.print sees every order; print.edit only within its order scope.
export async function GET(_req: Request, { params }: Params) {
  try {
    const ctx = await requirePrintCtx();
    const order = await printReadableOrder(ctx, Number((await params).id));
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    return NextResponse.json({
      kits: await loadKitViews(order.id),
      canEdit: canEditPrintAt(order.status, ctx.permissions),
    });
  } catch (e) {
    return apiError(e);
  }
}
