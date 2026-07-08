import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { applyCodReceived } from "@/lib/courier";

// SPEC §7 — COD reconciliation for Accounts: bulk "mark COD received". Records
// the COD collection as a payment (settling the order's due) and auto-posts the
// courier's COD fee as an expense. Idempotent per shipment. walletId attributes
// the remitted COD to the receiving company wallet (SPEC §8) — optional.
const bodySchema = z.object({
  shipmentIds: z.array(z.number().int().positive()).min(1, "Select at least one shipment"),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  walletId: z.number().int().positive().nullable().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requirePermission("courier.manage");
    const data = bodySchema.parse(await req.json());
    const receivedDate = new Date(`${data.receivedDate}T00:00:00+06:00`);

    if (data.walletId) {
      const wallet = await prisma.wallet.findUnique({
        where: { id: data.walletId },
        select: { isActive: true },
      });
      if (!wallet) throw new AuthzError(400, "Receiving wallet not found");
      if (!wallet.isActive) throw new AuthzError(400, "Receiving wallet is inactive");
    }

    const result = await prisma.$transaction((tx) =>
      applyCodReceived(
        tx,
        data.shipmentIds,
        receivedDate,
        session.user.id,
        data.walletId ?? null
      )
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
