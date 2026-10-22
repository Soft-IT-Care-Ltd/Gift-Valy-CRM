import { readFile } from "fs/promises";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { UPLOAD_CONTENT_TYPE, uploadPath } from "@/lib/file-storage";

// FUNNEL_LINER.md GV-11 — uploads (catalog photos, payment screenshots,
// expense receipts, the invoice logo) are served here, to signed-in people
// only, never as a public static path. The URLs stored in the database stay
// /uploads/<name>. The files live in UPLOAD_DIR, outside the release
// (lib/file-storage.ts); Nginx never serves that folder. While Funnel Liner
// has the shop suspended, the billing lock closes this path like any page.

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // One flat file named by the server — anything else was never written by us.
  const { path: segments } = await params;
  if (segments.length !== 1) return notFound();
  const file = uploadPath(segments[0]);
  if (!file) return notFound();
  const ext = segments[0].split(".").pop()!.toLowerCase();

  try {
    const data = await readFile(file);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": UPLOAD_CONTENT_TYPE[ext],
        "Content-Length": String(data.length),
        // Names are random and never reused: safe to keep, but only in this browser.
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}
