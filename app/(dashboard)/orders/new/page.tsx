import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { packageAvailable } from "@/lib/catalog";
import { OrderForm } from "@/components/orders/order-form";

export const dynamic = "force-dynamic";

// Full order entry form (§4.1) — catalog options carry price + floor only,
// never costs (CLAUDE.md rule 1).
export default async function NewOrderPage() {
  const session = await requirePagePermission("orders.create");
  const permissions = await getEffectivePermissions(session.user.id);

  const [user, products, packages, wallets] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { name: true, team: { select: { name: true } } },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.package.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: { items: { include: { product: true } } },
    }),
    prisma.wallet.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
  ]);

  return (
    <OrderForm
      mode="create"
      products={products.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        sellingPrice: Number(p.sellingPrice),
        priceFloor: Number(p.priceFloor),
        unit: p.unit,
      }))}
      packages={packages.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        sellingPrice: Number(p.sellingPrice),
        priceFloor: Number(p.priceFloor),
        availableToSell: packageAvailable(p),
      }))}
      canOverrideFloor={permissions.includes("orders.approve_edit")}
      seName={user.name}
      teamName={user.team?.name ?? null}
      wallets={wallets}
    />
  );
}
