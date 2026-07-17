import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission, apiError, AuthzError } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { upsertRecipientOccasions } from "@/lib/occasions";
import { normalizePhone } from "@/lib/order-constants";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanDate(v: unknown): string | null {
  return typeof v === "string" && DATE_RE.test(v) ? v : null;
}

// CORRECTIONS Orders §7 (C8) — add / upsert a recipient occasion profile from
// the Occasions page (occasions manageable outside the order form). Keyed by
// (customer, recipient BD phone); an existing recipient is refreshed in place.
export async function POST(req: Request) {
  try {
    const session = await requirePermission("orders.create");
    const body = await req.json();

    const customerId = Number(body.customerId);
    const recipientName = String(body.recipientName ?? "").trim();
    const recipientPhoneBd = normalizePhone(String(body.recipientPhoneBd ?? ""));
    const relation =
      typeof body.relation === "string" && body.relation ? body.relation : null;
    const birthday = cleanDate(body.birthday);
    const anniversary = cleanDate(body.anniversary);

    if (!customerId || !recipientName || !recipientPhoneBd) {
      throw new AuthzError(400, "Customer, recipient name and phone are required");
    }
    if (!birthday && !anniversary) {
      throw new AuthzError(400, "Enter at least one date (birthday or anniversary)");
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) throw new AuthzError(404, "Customer not found");

    await upsertRecipientOccasions(prisma, {
      customerId,
      recipientName,
      recipientPhoneBd,
      relation,
      birthday,
      anniversary,
      userId: session.user.id,
    });

    await logAudit({
      userId: session.user.id,
      action: "occasion.upsert",
      entity: "customer_occasions",
      entityId: `${customerId}:${recipientPhoneBd}`,
      after: { recipientName, relation, birthday, anniversary },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
