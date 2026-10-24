import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { apiError, requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { saveUpload } from "@/lib/file-storage";
import { getPrintSettings } from "@/lib/settings";
import { slotPixels } from "@/lib/print-layouts";
import { serializeCardDesign } from "@/lib/card-library";

type Params = { params: Promise<{ id: string }> };

const MAX_BYTES = 15 * 1024 * 1024;

// PHOTO_PRINT.md PP-3 — a card design's background (the owner's design WITHOUT
// text). Turned the right way up, converted to sRGB and cover-cropped to the
// card's exact 300 DPI pixel size, then stored as a normal upload
// (card-bg-<uuid>.jpg, served signed-in only). The renderer crops again if a
// card size changes later, so an old background never breaks printing.
export async function POST(req: Request, { params }: Params) {
  try {
    const session = await requirePermission("print.settings");
    const id = Number((await params).id);
    const design = await prisma.cardDesign.findUnique({ where: { id } });
    if (!design) return NextResponse.json({ error: "Design not found" }, { status: 404 });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image must be 15MB or smaller" }, { status: 400 });
    }
    const input = Buffer.from(await file.arrayBuffer());
    // The type comes from what sharp reads, never the file name.
    const meta = await sharp(input).metadata().catch(() => null);
    if (!meta || !["jpeg", "png", "webp"].includes(meta.format ?? "")) {
      return NextResponse.json({ error: "Only JPEG, PNG or WebP images are allowed" }, { status: 400 });
    }

    const { sizes } = await getPrintSettings();
    const px = slotPixels(sizes[design.slot]);
    const jpg = await sharp(input)
      .rotate()
      .toColourspace("srgb")
      .resize(px.w, px.h, { fit: "cover" })
      .withMetadata({ density: 300 })
      .jpeg({ quality: 95 })
      .toBuffer();
    const url = await saveUpload(`card-bg-${randomUUID()}.jpg`, jpg);

    const after = await prisma.cardDesign.update({
      where: { id },
      data: { backgroundPath: url, updatedBy: session.user.id },
    });
    await logAudit({
      userId: session.user.id,
      action: "card_design.background",
      entity: "card_designs",
      entityId: id,
      before: { backgroundPath: design.backgroundPath },
      after: { backgroundPath: url, source: { width: meta.width, height: meta.height } },
    });
    return NextResponse.json(serializeCardDesign(after));
  } catch (e) {
    return apiError(e);
  }
}
