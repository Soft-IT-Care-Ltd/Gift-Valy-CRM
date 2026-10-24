import { NextResponse } from "next/server";
import { apiError, requirePermission } from "@/lib/authz";
import { markOrderPrinted } from "@/lib/print-pdf-build";

type Params = { params: Promise<{ id: string }> };

// PHOTO_PRINT.md PP-7 — "Mark printed" (again = a logged reprint).
export async function POST(_req: Request, { params }: Params) {
  try {
    const session = await requirePermission("print.print");
    const result = await markOrderPrinted(Number((await params).id), session.user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return apiError(e);
  }
}
