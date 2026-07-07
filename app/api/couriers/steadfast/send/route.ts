import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { getSteadfastIntegration } from "@/lib/steadfast-integration";
import { sendOrdersToSteadfast } from "@/lib/steadfast-send";

// "Send to Steadfast" from the Orders PACKED tab (STEADFAST_INTEGRATION.md §2).
// Single or multi-select. Requires courier.manage AND an enabled integration.
const bodySchema = z.object({
  orderIds: z.array(z.number().int().positive()).min(1).max(500),
});

export async function POST(req: Request) {
  try {
    const session = await requirePermission("courier.manage");
    const { orderIds } = bodySchema.parse(await req.json());

    const integration = await getSteadfastIntegration();
    if (!integration || !integration.isEnabled) {
      throw new AuthzError(400, "Steadfast integration is not enabled");
    }

    const results = await sendOrdersToSteadfast(
      orderIds,
      integration,
      session.user.id
    );

    await logAudit({
      userId: session.user.id,
      action: "courier_integration.send",
      entity: "orders",
      after: {
        requested: orderIds.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
      },
    });

    return NextResponse.json({ results });
  } catch (e) {
    return apiError(e);
  }
}
