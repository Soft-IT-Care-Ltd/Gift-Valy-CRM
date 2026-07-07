import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { applyPurchase } from "@/lib/stock";

const bodySchema = z.object({
  supplierName: z.string().trim().min(1, "Supplier name is required"),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentStatus: z.enum(["PAID", "DUE", "PARTIAL"]).default("PAID"),
  notes: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        qty: z.number().int().min(1),
        unitCost: z.number().min(0),
      })
    )
    .min(1, "At least one product line is required"),
});

// Purchase entry (SPEC §6.3, Accounts/Admin): stock in + weighted-avg cost +
// IN_PURCHASE movements + auto-expense, one transaction (integrity rule 2).
export async function POST(req: Request) {
  try {
    const session = await requirePermission("purchases.create");
    const data = bodySchema.parse(await req.json());

    const ids = [...new Set(data.items.map((i) => i.productId))];
    if (ids.length !== data.items.length) {
      throw new AuthzError(400, "Duplicate product lines — merge quantities into one line");
    }
    const products = await prisma.product.findMany({ where: { id: { in: ids } } });
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const line of data.items) {
      const p = byId.get(line.productId);
      if (!p) throw new AuthzError(400, `Product #${line.productId} not found`);
      if (!p.isStockTracked) {
        throw new AuthzError(
          400,
          `"${p.name}" is a per-order (non-stock) product — its cost is entered on the order, not via purchase entry`
        );
      }
    }

    const purchase = await prisma.$transaction((tx) =>
      applyPurchase(tx, {
        supplierName: data.supplierName,
        purchaseDate: new Date(`${data.purchaseDate}T00:00:00+06:00`),
        paymentStatus: data.paymentStatus,
        notes: data.notes,
        lines: data.items,
        userId: session.user.id,
      })
    );

    await logAudit({
      userId: session.user.id,
      action: "purchase.create",
      entity: "purchases",
      entityId: purchase.id,
      after: {
        supplier: data.supplierName,
        date: data.purchaseDate,
        total: Number(purchase.totalAmount),
        items: data.items,
      },
    });
    return NextResponse.json(
      { id: purchase.id, totalAmount: Number(purchase.totalAmount) },
      { status: 201 }
    );
  } catch (e) {
    return apiError(e);
  }
}
