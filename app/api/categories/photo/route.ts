import { NextResponse } from "next/server";
import { requirePermission, apiError } from "@/lib/authz";
import {
  CATEGORY_PHOTO_MAX_BYTES,
  CATEGORY_PHOTO_TYPES,
  CategoryPhotoError,
  saveCategoryPhoto,
} from "@/lib/category-photo";

// ROUND3 R3-1 — POST a category photo (multipart "file"): JPEG / PNG / WebP up
// to 10 MB, stored resized (≤1200 px), as WebP, EXIF stripped. Returns the URL
// the category form then saves on the category (PATCH/POST /api/categories),
// where the add/replace/remove is audited.
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    await requirePermission("catalog.manage");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!CATEGORY_PHOTO_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG or WebP images are allowed" },
        { status: 400 }
      );
    }
    if (file.size > CATEGORY_PHOTO_MAX_BYTES) {
      return NextResponse.json(
        { error: "Image must be 10MB or smaller" },
        { status: 400 }
      );
    }
    const url = await saveCategoryPhoto(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ url }, { status: 201 });
  } catch (e) {
    if (e instanceof CategoryPhotoError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return apiError(e);
  }
}
