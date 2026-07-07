import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { canSeeCosts } from "@/lib/catalog";
import { StockClient, type StockRow } from "@/components/stock/stock-client";

export const dynamic = "force-dynamic";

// Stock report (SPEC §6.3): on-hand, reserved, available, low-stock list —
// avg cost & stock value only for cost-privileged roles (CLAUDE.md rule 1;
// Packing has stock.view but must never see costs).
export default async function StockPage() {
  const session = await requirePagePermission("stock.view");
  const permissions = await getEffectivePermissions(session.user.id);
  const showCosts = canSeeCosts(permissions);
  const canAdjust = permissions.includes("stock.adjust");

  const products = await prisma.product.findMany({
    orderBy: { name: "asc" },
    include: { category: { select: { name: true } } },
  });

  const rows: StockRow[] = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category.name,
    unit: p.unit,
    isStockTracked: p.isStockTracked,
    isActive: p.isActive,
    stockQty: p.stockQty,
    reservedQty: p.reservedQty,
    available: p.stockQty - p.reservedQty,
    lowStockThreshold: p.lowStockThreshold,
    ...(showCosts
      ? {
          avgCost: Number(p.avgCost),
          stockValue: Math.round(p.stockQty * Number(p.avgCost) * 100) / 100,
        }
      : {}),
  }));

  return <StockClient rows={rows} showCosts={showCosts} canAdjust={canAdjust} />;
}
