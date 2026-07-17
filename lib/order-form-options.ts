import type { Prisma, PrismaClient } from "@prisma/client";
import { BomError, collectChoiceGroups, packageAvailability, type BomCatalog } from "./bom";
import type {
  PackageOption,
  ProductOption,
} from "@/components/orders/order-form";

type Tx = Prisma.TransactionClient | PrismaClient;

// Catalog options for the order form (§4.1 C) — price + floor + zone charges
// only, never costs (CLAUDE.md rule 1). Component-only products are excluded
// from the picker entirely (CORRECTIONS Products §1); packages carry their
// choice groups so the form can prompt for variants (§5).
export async function loadOrderFormOptions(
  db: Tx,
  catalog: BomCatalog
): Promise<{ products: ProductOption[]; packages: PackageOption[] }> {
  const [products, packages] = await Promise.all([
    db.product.findMany({
      where: { isActive: true, productType: "SELLABLE" },
      orderBy: { name: "asc" },
    }),
    db.package.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    products: products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      sellingPrice: Number(p.sellingPrice),
      priceFloor: Number(p.priceFloor),
      unit: p.unit,
      zoneCharges: {
        INSIDE_DHAKA: Number(p.deliveryChargeInsideDhaka),
        SUB_DHAKA: Number(p.deliveryChargeSubDhaka),
        OUTSIDE_DHAKA: Number(p.deliveryChargeOutsideDhaka),
      },
    })),
    packages: packages.map((p) => {
      let availableToSell: number | null = null;
      let choiceGroups: PackageOption["choiceGroups"] = [];
      try {
        availableToSell = packageAvailability(catalog, p.id);
        choiceGroups = collectChoiceGroups(catalog, p.id).map((g) => ({
          groupId: g.groupId,
          label: g.label,
          path: g.path,
          options: g.options.map((o) => {
            const product = catalog.products.get(o.productId);
            return {
              productId: o.productId,
              name: product?.name ?? `#${o.productId}`,
              isDefault: o.isDefault,
              stockQty: product?.stockQty ?? 0,
            };
          }),
        }));
      } catch (e) {
        if (!(e instanceof BomError)) throw e; // broken BOM → sell without prompts
      }
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        sellingPrice: Number(p.sellingPrice),
        priceFloor: Number(p.priceFloor),
        availableToSell,
        zoneCharges: {
          INSIDE_DHAKA: Number(p.deliveryChargeInsideDhaka),
          SUB_DHAKA: Number(p.deliveryChargeSubDhaka),
          OUTSIDE_DHAKA: Number(p.deliveryChargeOutsideDhaka),
        },
        choiceGroups,
      };
    }),
  };
}
