import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AuthzError, apiError, requirePermission, requireUser } from "@/lib/authz";
import { getEffectivePermissions } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { PRINT_LIBRARY_READ, cardDesignSchema, serializeCardDesign } from "@/lib/card-library";
import { printFontPath } from "@/lib/file-storage";

// PHOTO_PRINT.md PP-3 — card designs. Any print role reads them (inactive
// ones only with print.settings); creating/editing needs print.settings.
// Designs are deactivated, never deleted — orders will point at them (PP-4).
export async function GET() {
  try {
    const session = await requireUser();
    const permissions = await getEffectivePermissions(session.user.id);
    if (!PRINT_LIBRARY_READ.some((k) => permissions.includes(k))) {
      throw new AuthzError(403, "Missing permission: print.edit");
    }
    const all = permissions.includes("print.settings");
    const designs = await prisma.cardDesign.findMany({
      where: all ? {} : { isActive: true },
      orderBy: [{ slot: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(designs.map(serializeCardDesign));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requirePermission("print.settings");
    const data = cardDesignSchema.parse(await req.json());
    if (data.fontPath && !printFontPath(data.fontPath)) {
      return NextResponse.json({ error: "Unknown font" }, { status: 400 });
    }
    const design = await prisma.cardDesign.create({
      data: { ...data, createdBy: session.user.id, updatedBy: session.user.id },
    });
    await logAudit({
      userId: session.user.id,
      action: "card_design.create",
      entity: "card_designs",
      entityId: design.id,
      after: design,
    });
    return NextResponse.json(serializeCardDesign(design), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
