import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { CategoriesClient } from "@/components/catalog/categories-client";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  await requirePagePermission("catalog.manage");

  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } } },
  });

  return (
    <CategoriesClient
      categories={categories.map((c) => ({
        id: c.id,
        name: c.name,
        productsCount: c._count.products,
      }))}
    />
  );
}
