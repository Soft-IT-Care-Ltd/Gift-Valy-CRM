import { NextResponse } from "next/server";
import { apiError, requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { BANNER_MAX_BYTES, BANNER_TYPES, BannerImageError, saveBannerImage } from "@/lib/home-page/images";

// ROUND3 W-7 — upload a banner photo (multipart "file" + "kind": desktop |
// mobile): JPEG / PNG / WebP up to 10 MB, re-encoded to WebP with EXIF
// stripped and resized (lib/home-page/images.ts). It shows on the website
// only once a published home page uses it.
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = await requirePermission("website.home");
    const form = await req.formData();
    const file = form.get("file");
    const kind = form.get("kind");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a photo" }, { status: 400 });
    if (kind !== "desktop" && kind !== "mobile") return NextResponse.json({ error: "Say whether it is the desktop or the mobile photo" }, { status: 400 });
    if (!BANNER_TYPES.includes(file.type)) return NextResponse.json({ error: "Only JPEG, PNG or WebP images are allowed" }, { status: 400 });
    if (file.size > BANNER_MAX_BYTES) return NextResponse.json({ error: "Image must be 10MB or smaller" }, { status: 400 });
    const image = await saveBannerImage(Buffer.from(await file.arrayBuffer()), kind);
    await logAudit({ userId: session.user.id, action: "website.banner.upload", entity: "home_page", entityId: image.file, after: { kind, ...image } });
    return NextResponse.json({ image }, { status: 201 });
  } catch (e) {
    if (e instanceof BannerImageError) return NextResponse.json({ error: e.message }, { status: 400 });
    return apiError(e);
  }
}
