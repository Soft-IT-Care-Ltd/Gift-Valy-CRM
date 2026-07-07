import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { applyCodReceived } from "@/lib/courier";

// SPEC §7 — COD reconciliation for Accounts: bulk "mark COD received". Records
// the COD collection as a payment (settling the order's due) and auto-posts the
// courier's COD fee as an expense. Idempotent per shipment.
const bodySchema = z.object({
  shipmentIds: z.array(z.number().int().positive()).min(1, "Select at least one shipment"),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: Request) {
  try {
    const session = await requirePermission("courier.manage");
    const data = bodySchema.parse(await req.json());
    const receivedDate = new Date(`${data.receivedDate}T00:00:00+06:00`);

    const result = await prisma.$transaction((tx) =>
      applyCodReceived(tx, data.shipmentIds, receivedDate, session.user.id)
    );

    await logAudit({
      userId: session.user.id,
      action: "shipment.cod_reconcile",
      entity: "shipments",
      entityId: data.shipmentIds.join(","),
      after: result,
    });
    return NextResponse.json(result);
  } catch (e) {
    return apiError(e);
  }
}
