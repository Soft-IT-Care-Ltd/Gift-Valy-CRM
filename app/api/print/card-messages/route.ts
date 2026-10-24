import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthzError, apiError, requirePermission, requireUser } from "@/lib/authz";
import { getEffectivePermissions } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { hasNameSlots } from "@/lib/print-constants";
import {
  PRINT_LIBRARY_READ,
  cardMessageSchema,
  serializeCardMessage,
} from "@/lib/card-library";

// PHOTO_PRINT.md PP-3 — the card message library. Any print role reads it
// (inactive messages only with print.settings); adding/editing needs
// print.settings. Messages are deactivated, never deleted.
export async function GET() {
  try {
    const session = await requireUser();
    const permissions = await getEffectivePermissions(session.user.id);
    if (!PRINT_LIBRARY_READ.some((k) => permissions.includes(k))) {
      throw new AuthzError(403, "Missing permission: print.edit");
    }
    const all = permissions.includes("print.settings");
    const messages = await prisma.cardMessage.findMany({
      where: all ? {} : { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    return NextResponse.json(messages.map(serializeCardMessage));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requirePermission("print.settings");
    const data = cardMessageSchema.parse(await req.json());
    const last = await prisma.cardMessage.aggregate({ _max: { sortOrder: true } });
    try {
      const message = await prisma.cardMessage.create({
        data: {
          ...data,
          hasNameSlots: hasNameSlots(data.text),
          sortOrder: (last._max.sortOrder ?? 0) + 10,
          createdBy: session.user.id,
          updatedBy: session.user.id,
        },
      });
      await logAudit({
        userId: session.user.id,
        action: "card_message.create",
        entity: "card_messages",
        entityId: message.id,
        after: message,
      });
      return NextResponse.json(serializeCardMessage(message), { status: 201 });
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
