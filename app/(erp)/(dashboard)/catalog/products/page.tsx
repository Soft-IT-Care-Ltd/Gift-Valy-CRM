import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import {
  canSeeCosts,
  productSerializeInclude,
  serializeProduct,
} from "@/lib/catalog";
import { loadBomCatalog } from "@/lib/bom-db";
import { ProductsClient } from "@/components/catalog/products-client";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const session = await requirePagePermission("catalog.view");
  const permissions = await getEffectivePermissions(session.user.id);
  const showCosts = canSeeCosts(permissions);
  const canManage = permissions.includes("catalog.manage");

  const [products, categories, catalog] = await Promise.all([
    prisma.product.findMany({
      orderBy: { name: "asc" },
      include: productSerializeInclude,
    }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    loadBomCatalog(prisma),
  ]);

  return (
    <ProductsClient
      products={products.map((p) => serializeProduct(p, catalog, showCosts))}
      categories={categories}
      // Packing-materials picker (CORRECTIONS Products §2): active
      // component-only products.
      componentOptions={products
        .filter((p) => p.productType === "COMPONENT" && p.isActive)
        .map((p) => ({ id: p.id, name: p.name, sku: p.sku, stockQty: p.stockQty }))}
      showCosts={showCosts}
      canManage={canManage}
    />
  );
}
