import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { canSeeCosts, serializeProduct } from "@/lib/catalog";
import { ProductsClient } from "@/components/catalog/products-client";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const session = await requirePagePermission("catalog.view");
  const permissions = await getEffectivePermissions(session.user.id);
  const showCosts = canSeeCosts(permissions);
  const canManage = permissions.includes("catalog.manage");

  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      orderBy: { name: "asc" },
      include: { category: true },
    }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <ProductsClient
      products={products.map((p) => serializeProduct(p, showCosts))}
      categories={categories}
      showCosts={showCosts}
      canManage={canManage}
    />
  );
}
