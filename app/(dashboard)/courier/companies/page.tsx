import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { serializeCourier } from "@/lib/courier";
import { CourierCompaniesClient } from "@/components/courier/courier-companies-client";

export const dynamic = "force-dynamic";

// SPEC §7 — courier companies with COD fee % and per-district zone charges.
export default async function CourierCompaniesPage() {
  await requirePagePermission("courier.manage");

  const couriers = await prisma.courier.findMany({
    orderBy: { name: "asc" },
    include: { zoneCharges: true, _count: { select: { shipments: true } } },
  });

  return <CourierCompaniesClient couriers={couriers.map(serializeCourier)} />;
}
