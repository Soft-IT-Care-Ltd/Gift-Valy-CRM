import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, requirePermission } from "@/lib/authz";
import { deletePrintFiles } from "@/lib/file-storage";
import { previewName } from "@/lib/print-photos";

type Params = { params: Promise<{ id: string }> };

// PHOTO_PRINT.md PP-4 — remove a staged photo from the unsaved order form.
// Only its uploader, and only while it is still staged.
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const session = await requirePermission("print.edit");
    const id = Number((await params).id);
    const photo = await prisma.orderPrintPhoto.findUnique({ where: { id } });
    if (!photo || photo.kitId != null || photo.stagedBy !== session.user.id) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }
    await prisma.orderPrintPhoto.delete({ where: { id } });
    await deletePrintFiles([photo.originalPath, previewName(photo.originalPath), photo.printPath]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
