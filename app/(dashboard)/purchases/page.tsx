import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
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

  const [purchases, products] = await Promise.all([
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
  ]);

  const rows: PurchaseRow[] = purchases.map((p) => ({
    id: p.id,
    supplierName: p.supplierName,
    purchaseDate: p.purchaseDate.toISOString().slice(0, 10),
    totalAmount: Number(p.totalAmount),
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
  }));

  const options: ProductOption[] = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    unit: p.unit,
    avgCost: Number(p.avgCost),
    stockQty: p.stockQty,
  }));

  return <PurchasesClient purchases={rows} products={options} />;
}
