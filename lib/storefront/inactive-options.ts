import type { BomCatalog } from "@/lib/bom";

// Verify R3 — a choice option whose product was deactivated in the Catalog
// stays in its package's BOM (the ERP keeps it for old orders), but the
// website must never sell it: it is treated as tracked stock with nothing
// left, so the product page shows it "Out of stock" (a package starts with
// another option), the bag says so and the order endpoint refuses it (409).
// Pure — catalog.ts and place-order.ts pass in the ids they read.
export function withdrawInactiveOptions(catalog: BomCatalog, inactiveOptionIds: Iterable<number>): BomCatalog {
  for (const id of inactiveOptionIds) {
    const p = catalog.products.get(id);
    if (p) catalog.products.set(id, { ...p, isStockTracked: true, stockQty: 0 });
  }
  return catalog;
}
