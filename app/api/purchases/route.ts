import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { applyPurchase } from "@/lib/stock";

const round2 = (n: number) => Math.round(n * 100) / 100;

const bodySchema = z.object({
  supplierName: z.string().trim().min(1, "Supplier name is required"),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Cash paid at entry (SPEC §6.3 supplier credit): the full total for a Paid
  // purchase, a portion for Partial, 0 for Due. Cost is expensed only for this.
  paidAmount: z.number().min(0).default(0),
  walletId: z.number().int().positive().nullable().optional(), // required when paidAmount > 0
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(), // required when not fully paid
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

    // Payment validation (SPEC §6.3 supplier credit). Total is authoritative
    // server-side; paidAmount must fit within it. Any unpaid balance needs a
    // due date; any cash paid needs an active receiving wallet.
    const total = round2(data.items.reduce((s, l) => s + l.qty * l.unitCost, 0));
    const paidAmount = round2(data.paidAmount);
    if (paidAmount > total) {
      throw new AuthzError(400, "Amount paid cannot exceed the purchase total");
    }
    if (paidAmount > 0) {
      if (!data.walletId) {
        throw new AuthzError(400, "Select the wallet the payment came from");
      }
      const wallet = await prisma.wallet.findUnique({
        where: { id: data.walletId },
        select: { isActive: true },
      });
      if (!wallet) throw new AuthzError(400, "Paying wallet not found");
      if (!wallet.isActive) throw new AuthzError(400, "Paying wallet is inactive");
    }
    if (paidAmount < total && !data.dueDate) {
      throw new AuthzError(400, "Set the date the remaining balance is due");
    }

    const purchase = await prisma.$transaction((tx) =>
      applyPurchase(tx, {
        supplierName: data.supplierName,
        purchaseDate: new Date(`${data.purchaseDate}T00:00:00+06:00`),
        paidAmount,
        walletId: paidAmount > 0 ? data.walletId ?? null : null,
        dueDate:
          paidAmount < total && data.dueDate
            ? new Date(`${data.dueDate}T00:00:00+06:00`)
            : null,
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
        paid: paidAmount,
        paymentStatus: purchase.paymentStatus,
        walletId: paidAmount > 0 ? data.walletId ?? null : null,
        dueDate: paidAmount < total ? data.dueDate ?? null : null,
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
