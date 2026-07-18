import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { requirePermission, apiError } from "@/lib/authz";

// CORRECTIONS §R9 — the invoice logo upload. Separate from the shared
// /api/uploads route because (a) it is settings.manage-gated, and (b) pdfkit
// embeds only PNG/JPEG — WebP (allowed for catalog photos) would silently fall
// back to the placeholder on every invoice.
const MAX_BYTES = 2 * 1024 * 1024;
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

export async function POST(req: Request) {
  try {
    await requirePermission("settings.manage");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const ext = EXT_BY_TYPE[file.type];
    if (!ext) {
      return NextResponse.json(
        { error: "The invoice logo must be a PNG or JPEG image" },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Logo must be 2MB or smaller" },
        { status: 400 }
      );
    }

    const name = `invoice-logo-${randomUUID()}.${ext}`;
    const dir = path.join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));

    return NextResponse.json({ url: `/uploads/${name}` }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
