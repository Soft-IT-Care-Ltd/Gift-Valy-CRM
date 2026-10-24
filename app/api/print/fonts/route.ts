import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { apiError, requirePermission } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { listPrintFonts, savePrintFont } from "@/lib/file-storage";
import { fontDisplayName, inspectFont } from "@/lib/print-card";

const MAX_BYTES = 10 * 1024 * 1024;

// PHOTO_PRINT.md PP-3 — extra fonts for card designs (print.settings). The
// default is Noto Sans Bengali Bold; an Admin may upload another .ttf/.otf.
// Fonts are only read by the server's card renderer, never served.
export async function GET() {
  try {
    await requirePermission("print.settings");
    const names = await listPrintFonts();
    return NextResponse.json(names.map((name) => ({ fontPath: name, name: fontDisplayName(name) })));
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requirePermission("print.settings");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Font must be 10MB or smaller" }, { status: 400 });
    }
    const data = Buffer.from(await file.arrayBuffer());
    let info: { family: string; bangla: boolean };
    try {
      info = inspectFont(data);
    } catch {
      return NextResponse.json({ error: "That file is not a TrueType/OpenType font" }, { status: 400 });
    }
    // OpenType with CFF outlines starts with "OTTO"; everything else is TrueType.
    const ext = data.subarray(0, 4).toString("latin1") === "OTTO" ? "otf" : "ttf";
    const fontPath = await savePrintFont(`${randomUUID()}.${ext}`, data);
    await logAudit({
      userId: session.user.id,
      action: "card_font.upload",
      entity: "card_fonts",
      entityId: fontPath,
      after: { fontPath, family: info.family, bangla: info.bangla, originalName: file.name },
    });
    return NextResponse.json({ fontPath, name: info.family, bangla: info.bangla }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
