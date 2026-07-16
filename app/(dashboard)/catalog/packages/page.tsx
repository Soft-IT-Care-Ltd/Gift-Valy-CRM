import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import {
  canSeeCosts,
  packageSerializeInclude,
  serializePackage,
} from "@/lib/catalog";
import { loadBomCatalog } from "@/lib/bom-db";
import { PackagesClient } from "@/components/catalog/packages-client";

export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  const session = await requirePagePermission("catalog.view");
  const permissions = await getEffectivePermissions(session.user.id);
  const showCosts = canSeeCosts(permissions);
  const canManage = permissions.includes("catalog.manage");

  const [packages, products, catalog] = await Promise.all([
    prisma.package.findMany({
      orderBy: { name: "asc" },
      include: packageSerializeInclude,
    }),
    // BOM picker options — avgCost only rides along for cost-visible roles
    // (canManage implies showCosts), enabling the live cost preview.
    // Component-only products ARE listed (a package consumes cartons/boxes).
    prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
    loadBomCatalog(prisma),
  ]);

  return (
    <PackagesClient
      packages={packages.map((p) => serializePackage(p, catalog, showCosts))}
      products={products.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        productType: p.productType,
        stockQty: p.stockQty,
        isStockTracked: p.isStockTracked,
        ...(showCosts ? { avgCost: Number(p.avgCost) } : {}),
      }))}
      showCosts={showCosts}
      canManage={canManage}
    />
  );
}
