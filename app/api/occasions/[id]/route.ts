import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { updateOccasion } from "@/lib/occasions";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanDate(v: unknown): string | null {
  return typeof v === "string" && DATE_RE.test(v) ? v : null;
}

// CORRECTIONS Orders §7 (C8) — edit an occasion profile: recipient name,
// relation, and birthday/anniversary (clearing a date removes that occasion).
// Deleting removes the recipient profile entirely. Gated on orders.create.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission("orders.create");
    const id = Number((await params).id);
    if (!id) throw new AuthzError(400, "Invalid occasion id");

    const before = await prisma.customerOccasion.findUnique({
      where: { id },
      select: { recipientName: true, relation: true, birthday: true, anniversary: true },
    });
    if (!before) throw new AuthzError(404, "Occasion not found");

    const body = await req.json();
    const birthday = cleanDate(body.birthday);
    const anniversary = cleanDate(body.anniversary);
    const recipientName =
      typeof body.recipientName === "string" && body.recipientName.trim()
        ? body.recipientName.trim()
        : undefined;
    const relation =
      body.relation === null
        ? null
        : typeof body.relation === "string" && body.relation
          ? body.relation
          : undefined;

    // Clearing BOTH dates would leave an empty profile — delete it instead so
    // the window builder (which requires ≥1 date) stays consistent.
    if (!birthday && !anniversary) {
      await prisma.customerOccasion.delete({ where: { id } });
    } else {
      await updateOccasion(prisma, id, {
        recipientName,
        relation,
        birthday,
        anniversary,
        userId: session.user.id,
      });
    }

    await logAudit({
      userId: session.user.id,
      action: birthday || anniversary ? "occasion.update" : "occasion.delete",
      entity: "customer_occasions",
      entityId: id,
      before,
      after: { recipientName, relation, birthday, anniversary },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requirePermission("orders.create");
    const id = Number((await params).id);
    if (!id) throw new AuthzError(400, "Invalid occasion id");

    const before = await prisma.customerOccasion.findUnique({ where: { id } });
    if (!before) throw new AuthzError(404, "Occasion not found");

    await prisma.customerOccasion.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: "occasion.delete",
      entity: "customer_occasions",
      entityId: id,
      before: {
        recipientName: before.recipientName,
        relation: before.relation,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
