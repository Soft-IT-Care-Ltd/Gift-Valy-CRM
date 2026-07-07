import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { runSteadfastPoll } from "@/lib/steadfast-sync";

// Manual "Sync now" (STEADFAST_INTEGRATION.md §3B) — the polling fallback on
// demand. Optional shipmentId drives the per-shipment refresh icon (ignores the
// polling interval). Requires courier.manage.
const bodySchema = z
  .object({ shipmentId: z.number().int().positive().optional() })
  .optional();

export async function POST(req: Request) {
  try {
    const session = await requirePermission("courier.manage");
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    const summary = await runSteadfastPoll(
      body?.shipmentId ? { shipmentId: body.shipmentId } : undefined
    );

    await logAudit({
      userId: session.user.id,
      action: "courier_integration.sync",
      entity: "courier_integrations",
      after: summary,
    });

    return NextResponse.json(summary);
  } catch (e) {
    return apiError(e);
  }
}
