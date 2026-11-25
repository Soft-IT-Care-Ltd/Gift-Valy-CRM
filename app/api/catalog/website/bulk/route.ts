import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { applyWebsite, productWebsiteBlock } from "@/lib/catalog-website";

// ROUND3 W-2 — "Show on website / Hide" for the rows selected on the product
// or package list. Each item goes through the same applyWebsite() as its
// form (address made / kept, audit row "catalog.website"). COMPONENT
// products are never switched on.
const schema = z.object({
  kind: z.enum(["product", "package"]),
  ids: z.array(z.number().int().positive()).min(1).max(500),
  show: z.boolean(),
});

export async function POST(req: Request) {
  try {
    const session = await requirePermission("catalog.manage");
    const { kind, ids, show } = schema.parse(await req.json());
    const changed = await prisma.$transaction(
      async (tx) => {
        let n = 0;
        if (kind === "product") {
          const rows = await tx.product.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true, sku: true, sellingPrice: true, productType: true, isActive: true, showOnWebsite: true },
          });
          for (const r of rows) {
            const block = productWebsiteBlock(r.productType);
            if (block && show) continue;
            if (r.showOnWebsite === show) continue;
            await applyWebsite(tx, "product", r.id, { showOnWebsite: show }, {
              userId: session.user.id,
              name: r.name,
              code: r.sku,
              price: Number(r.sellingPrice),
              notEligible: block,
              isActive: r.isActive,
            });
            n++;
          }
        } else {
          const rows = await tx.package.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true, code: true, sellingPrice: true, isActive: true, showOnWebsite: true },
          });
          for (const r of rows) {
            if (r.showOnWebsite === show) continue;
            await applyWebsite(tx, "package", r.id, { showOnWebsite: show }, {
              userId: session.user.id,
              name: r.name,
              code: r.code,
              price: Number(r.sellingPrice),
              notEligible: null,
              isActive: r.isActive,
            });
            n++;
          }
        }
        return n;
      },
      { timeout: 60_000 }
    );
    return NextResponse.json({ changed });
  } catch (e) {
    return apiError(e);
  }
}
