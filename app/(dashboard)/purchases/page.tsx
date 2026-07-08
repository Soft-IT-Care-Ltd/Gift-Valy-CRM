import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { buildPurchaseDues } from "@/lib/purchases";
import type { WalletOption } from "@/lib/wallet";
import {
  PurchasesClient,
  type ProductOption,
  type PurchaseRow,
} from "@/components/purchases/purchases-client";

export const dynamic = "force-dynamic";

// Purchase entry (SPEC §6.3, Accounts/Admin/Manager). purchases.create is a
// cost-privileged permission by role design, so unit costs render freely here.
export default async function PurchasesPage() {
  await requirePagePermission("purchases.create");

  const [purchases, products, wallets, dues] = await Promise.all([
    prisma.purchase.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        items: { include: { product: { select: { name: true, sku: true, unit: true } } } },
      },
    }),
    prisma.product.findMany({
      where: { isActive: true, isStockTracked: true },
      orderBy: { name: "asc" },
      select: { id: true, sku: true, name: true, unit: true, avgCost: true, stockQty: true },
    }),
    prisma.wallet.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
    buildPurchaseDues(),
  ]);

  // Cash paid per purchase = Σ linked "Product Purchase" expenses (SPEC §6.3).
  const paidAgg = await prisma.expense.groupBy({
    by: ["refId"],
    where: { refTable: "purchases", refId: { in: purchases.map((p) => p.id) } },
    _sum: { amount: true },
  });
  const paidById = new Map(
    paidAgg.map((r) => [r.refId!, Math.round(Number(r._sum.amount ?? 0) * 100) / 100])
  );

  const rows: PurchaseRow[] = purchases.map((p) => {
    const total = Number(p.totalAmount);
    const paid = paidById.get(p.id) ?? 0;
    return {
      id: p.id,
      supplierName: p.supplierName,
      purchaseDate: p.purchaseDate.toISOString().slice(0, 10),
      dueDate: p.dueDate ? p.dueDate.toISOString().slice(0, 10) : null,
      totalAmount: total,
      paidAmount: paid,
      dueAmount: Math.round((total - paid) * 100) / 100,
      paymentStatus: p.paymentStatus,
      notes: p.notes,
      items: p.items.map((it) => ({
        sku: it.product.sku,
        name: it.product.name,
        unit: it.product.unit,
        qty: it.qty,
        unitCost: Number(it.unitCost),
        lineTotal: Number(it.lineTotal),
      })),
    };
  });

  const options: ProductOption[] = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    unit: p.unit,
    avgCost: Number(p.avgCost),
    stockQty: p.stockQty,
  }));

  const walletOptions: WalletOption[] = wallets.map((w) => ({
    id: w.id,
    name: w.name,
    type: w.type,
  }));

  return (
    <PurchasesClient
      purchases={rows}
      products={options}
      wallets={walletOptions}
      dues={dues}
    />
  );
}
