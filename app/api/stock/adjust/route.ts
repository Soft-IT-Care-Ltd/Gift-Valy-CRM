import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { applyMovements } from "@/lib/stock";

const bodySchema = z.object({
  productId: z.number().int().positive(),
  direction: z.enum(["PLUS", "MINUS"]),
  qty: z.number().int().min(1),
  reason: z.string().trim().min(3, "A reason is required for stock adjustments"),
});

// Manual stock adjust (SPEC §6.3) — requires stock.adjust + reason, writes an
// ADJUST_PLUS/ADJUST_MINUS ledger row and the audit log (SPEC §2.2).
export async function POST(req: Request) {
  try {
    const session = await requirePermission("stock.adjust");
    const data = bodySchema.parse(await req.json());

    const product = await prisma.product.findUnique({
      where: { id: data.productId },
    });
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    if (!product.isStockTracked) {
      throw new AuthzError(400, `"${product.name}" is not stock-tracked`);
    }
    if (data.direction === "MINUS" && product.stockQty < data.qty) {
      throw new AuthzError(
        400,
        `Cannot remove ${data.qty} — only ${product.stockQty} on hand`
      );
    }

    await prisma.$transaction((tx) =>
      applyMovements(
        tx,
        [
          {
            productId: data.productId,
            type: data.direction === "PLUS" ? "ADJUST_PLUS" : "ADJUST_MINUS",
            qty: data.direction === "PLUS" ? data.qty : -data.qty,
            reason: data.reason,
          },
        ],
        session.user.id
      )
    );

    await logAudit({
      userId: session.user.id,
      action: "stock.adjust",
      entity: "products",
      entityId: product.id,
      before: { sku: product.sku, name: product.name, stockQty: product.stockQty },
      after: {
        stockQty:
          product.stockQty + (data.direction === "PLUS" ? data.qty : -data.qty),
        direction: data.direction,
        qty: data.qty,
        reason: data.reason,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
