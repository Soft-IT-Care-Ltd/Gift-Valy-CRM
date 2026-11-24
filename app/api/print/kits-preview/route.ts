import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, requirePermission } from "@/lib/authz";
import { loadBomCatalog } from "@/lib/bom-db";
import { BomError } from "@/lib/bom";
import { desiredPrintKits } from "@/lib/print-kits";

// PHOTO_PRINT.md PP-4 — which print kits the order form's current lines need,
// with the same source keys the server gives the kits when the order is saved
// (same lines, same order → same keys). The form attaches staged photos and
// card choices to these keys.
const schema = z.object({
  items: z.array(
    z.object({
      itemType: z.enum(["PRODUCT", "PACKAGE"]),
      productId: z.number().int().positive().nullable().optional(),
      packageId: z.number().int().positive().nullable().optional(),
      qty: z.number().int().min(1).max(999),
      choiceSelections: z.record(z.string(), z.number().int().positive()).nullable().optional(),
    })
  ),
});

export async function POST(req: Request) {
  try {
    await requirePermission("print.edit");
    const { items } = schema.parse(await req.json());
    const catalog = await loadBomCatalog(prisma);
    let kits;
    try {
      kits = desiredPrintKits(
        catalog,
        items.map((it) => ({
          itemType: it.itemType,
          productId: it.productId ?? null,
          packageId: it.packageId ?? null,
          qty: it.qty,
          // The form's { groupId: productId } → the stored [{ groupId, productId }].
          choiceSelections: Object.entries(it.choiceSelections ?? {}).map(([g, p]) => ({
            groupId: Number(g),
            productId: p,
          })),
        }))
      );
    } catch (e) {
      if (e instanceof BomError) return NextResponse.json({ kits: [] });
      throw e;
    }
    // The kit's source: the product, or the package (its own kit).
    const nameOf = (k: (typeof kits)[number]) =>
      (k.productId != null
        ? catalog.products.get(k.productId)?.name
        : catalog.packages.get(k.packageId!)?.name) ?? "Kit";
    return NextResponse.json({
      kits: kits.map((k, i) => ({
        sourceKey: k.sourceKey,
        productId: k.productId,
        packageId: k.packageId,
        label: `${nameOf(k)} — Kit ${i + 1} of ${kits.length}`,
        spec: k.spec,
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}
