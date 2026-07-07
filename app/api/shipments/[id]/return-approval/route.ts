import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission, apiError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { applyReturnApproval } from "@/lib/courier";

type Params = { params: Promise<{ id: string }> };

// SPEC §1.3 / §7 — Admin approval of a return: restores stock (IN_RETURN) and
// records the return courier charge as an expense. Gated on courier.approve_return
// (Admin + Manager), a step above routine courier ops.
const bodySchema = z.object({
  returnCharge: z.number().min(0).default(0),
  note: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : null)),
});

export async function POST(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("courier.approve_return");
    const id = Number((await params).id);
    const data = bodySchema.parse(await req.json());

    await prisma.$transaction((tx) =>
      applyReturnApproval(
        tx,
        id,
        { returnCharge: data.returnCharge, note: data.note },
        session.user.id
      )
    );

    await logAudit({
      userId: session.user.id,
      action: "shipment.return_approve",
      entity: "shipments",
      entityId: id,
      after: { returnCharge: data.returnCharge, note: data.note },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
