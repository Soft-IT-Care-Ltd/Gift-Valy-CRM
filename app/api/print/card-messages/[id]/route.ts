import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { hasNameSlots } from "@/lib/print-constants";
import { cardMessageSchema, serializeCardMessage } from "@/lib/card-library";

type Params = { params: Promise<{ id: string }> };

// PHOTO_PRINT.md PP-3 — edit / (de)activate a card message (print.settings).
export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("print.settings");
    const id = Number((await params).id);
    const data = cardMessageSchema.parse(await req.json());
    const before = await prisma.cardMessage.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    try {
      const after = await prisma.cardMessage.update({
        where: { id },
        data: { ...data, hasNameSlots: hasNameSlots(data.text), updatedBy: session.user.id },
      });
      await logAudit({
        userId: session.user.id,
        action: "card_message.update",
        entity: "card_messages",
        entityId: id,
        before,
        after,
      });
      return NextResponse.json(serializeCardMessage(after));
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        return NextResponse.json({ error: "This message is already in the library" }, { status: 400 });
      }
      throw e;
    }
  } catch (e) {
    return apiError(e);
  }
}
