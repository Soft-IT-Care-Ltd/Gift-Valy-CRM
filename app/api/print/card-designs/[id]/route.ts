import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { cardDesignSchema, serializeCardDesign } from "@/lib/card-library";
import { printFontPath } from "@/lib/file-storage";

type Params = { params: Promise<{ id: string }> };

// PHOTO_PRINT.md PP-3 — edit a card design (print.settings). The background
// image has its own upload route (./background).
export async function PATCH(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("print.settings");
    const id = Number((await params).id);
    const data = cardDesignSchema.parse(await req.json());
    if (data.fontPath && !printFontPath(data.fontPath)) {
      return NextResponse.json({ error: "Unknown font" }, { status: 400 });
    }
    const before = await prisma.cardDesign.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: "Design not found" }, { status: 404 });
    const after = await prisma.cardDesign.update({
      where: { id },
      data: { ...data, updatedBy: session.user.id },
    });
    await logAudit({
      userId: session.user.id,
      action: "card_design.update",
      entity: "card_designs",
      entityId: id,
      before,
      after,
    });
    return NextResponse.json(serializeCardDesign(after));
  } catch (e) {
    return apiError(e);
  }
}
