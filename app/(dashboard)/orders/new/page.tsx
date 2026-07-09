import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { packageAvailable } from "@/lib/catalog";
import { leadScopeWhere } from "@/lib/leads";
import { CUSTOMER_COUNTRIES } from "@/lib/order-constants";
import { LEAD_SOURCE_LABELS, type InterestedItem } from "@/lib/lead-constants";
import {
  OrderForm,
  type OrderFormInitial,
  type ProductOption,
  type PackageOption,
} from "@/components/orders/order-form";

export const dynamic = "force-dynamic";

// Full order entry form (§4.1) — catalog options carry price + floor only,
// never costs (CLAUDE.md rule 1). When ?leadId is present, the order is a lead
// conversion (§3.2): the customer + interested items prefill and the lead links
// on submit.
export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string }>;
}) {
  const session = await requirePagePermission("orders.create");
  const permissions = await getEffectivePermissions(session.user.id);
  const { leadId: leadIdParam } = await searchParams;
  const leadId = Number(leadIdParam) || null;

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

  const productOptions: ProductOption[] = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    sellingPrice: Number(p.sellingPrice),
    priceFloor: Number(p.priceFloor),
    unit: p.unit,
  }));
  const packageOptions: PackageOption[] = packages.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    sellingPrice: Number(p.sellingPrice),
    priceFloor: Number(p.priceFloor),
    availableToSell: packageAvailable(p),
  }));

  // Lead conversion prefill (§3.2). Only leads the creator may see convert; an
  // already-converted lead is blocked server-side, so we surface that here too.
  let initial: OrderFormInitial | undefined;
  let convertLeadId: number | undefined;
  let leadLabel: string | undefined;
  if (leadId) {
    let scope;
    try {
      scope = await leadScopeWhere(session, permissions);
    } catch {
      scope = { assignedTo: session.user.id };
    }
    const lead = await prisma.lead.findFirst({
      where: { AND: [scope, { id: leadId }] },
      include: { convertedOrder: { select: { id: true } } },
    });
    if (lead && !lead.convertedOrder) {
      convertLeadId = lead.id;
      const country = CUSTOMER_COUNTRIES.includes(
        (lead.country ?? "") as (typeof CUSTOMER_COUNTRIES)[number]
      )
        ? lead.country!
        : "";
      const productById = new Map(productOptions.map((p) => [p.id, p]));
      const packageById = new Map(packageOptions.map((p) => [p.id, p]));
      const interested = Array.isArray(lead.interestedIn)
        ? (lead.interestedIn as unknown as InterestedItem[])
        : [];
      const items = interested
        .map((it) => {
          if (it.itemType === "PRODUCT") {
            const p = productById.get(it.id);
            return p
              ? {
                  itemType: "PRODUCT" as const,
                  productId: p.id,
                  packageId: null,
                  qty: 1,
                  unitPrice: p.sellingPrice,
                }
              : null;
          }
          const pk = packageById.get(it.id);
          return pk
            ? {
                itemType: "PACKAGE" as const,
                productId: null,
                packageId: pk.id,
                qty: 1,
                unitPrice: pk.sellingPrice,
              }
            : null;
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      initial = {
        recipientName: "",
        recipientPhoneBd: "",
        recipientRelation: null,
        deliveryAddress: "",
        district: "",
        thana: "",
        occasion: null,
        requestedDeliveryDate: null,
        items,
        discount: 0,
        courierCharge: 0,
        codAmount: 0,
        notes: null,
        customer: {
          name: lead.customerName ?? "",
          phoneForeign: lead.whatsappNumber,
          country,
        },
      };
      leadLabel = `${lead.customerName ?? lead.whatsappNumber} · ${
        LEAD_SOURCE_LABELS[lead.source]
      }`;
    }
  }

  return (
    <OrderForm
      mode="create"
      products={productOptions}
      packages={packageOptions}
      canOverrideFloor={permissions.includes("orders.approve_edit")}
      seName={user.name}
      teamName={user.team?.name ?? null}
      wallets={wallets}
      initial={initial}
      leadId={convertLeadId}
      leadLabel={leadLabel}
    />
  );
}
