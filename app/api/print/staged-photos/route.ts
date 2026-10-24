import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { PhotoError, storeOriginal } from "@/lib/print-photos";
import { photoView } from "@/lib/print-kit-ops";

// PHOTO_PRINT.md PP-4 — a photo uploaded on the NEW order form, before the
// order exists. It is "staged" under the form's token and the uploader; saving
// the order attaches it to its kit (POST /api/orders, printKits). Staged
// photos never saved are deleted by the nightly cleanup after 24 h.
const TOKEN = /^[A-Za-z0-9-]{16,64}$/;

export async function POST(req: Request) {
  try {
    const session = await requirePermission("print.edit");
    const form = await req.formData();
    const file = form.get("file");
    const token = String(form.get("token") ?? "");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (!TOKEN.test(token)) return NextResponse.json({ error: "Invalid form token" }, { status: 400 });
    const stored = await storeOriginal(Buffer.from(await file.arrayBuffer()));
    const photo = await prisma.orderPrintPhoto.create({
      data: {
        ...stored,
        crop: stored.crop as object,
        stageToken: token,
        stagedBy: session.user.id,
        uploadedBy: session.user.id,
      },
    });
    await logAudit({
      userId: session.user.id,
      action: "print.photo.upload",
      entity: "order_print_photos",
      entityId: photo.id,
      after: { staged: true, srcWidth: stored.srcWidth, srcHeight: stored.srcHeight, bytes: stored.srcBytes, name: file.name },
    });
    return NextResponse.json(photoView(photo), { status: 201 });
  } catch (e) {
    if (e instanceof PhotoError) return NextResponse.json({ error: e.message }, { status: 400 });
    return apiError(e);
  }
}
