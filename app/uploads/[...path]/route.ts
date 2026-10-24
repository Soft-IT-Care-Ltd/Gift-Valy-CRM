import { readFile } from "fs/promises";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getEffectivePermissions } from "@/lib/rbac";
import { UPLOAD_CONTENT_TYPE, printFilePath, uploadPath } from "@/lib/file-storage";
import { printReadableOrder } from "@/lib/print-access";

// FUNNEL_LINER.md GV-11 — uploads (catalog photos, payment screenshots,
// expense receipts, the invoice logo) are served here, to signed-in people
// only, never as a public static path. The URLs stored in the database stay
// /uploads/<name>. The files live in UPLOAD_DIR, outside the release
// (lib/file-storage.ts); Nginx never serves that folder. While Funnel Liner
// has the shop suspended, the billing lock closes this path like any page.
//
// PHOTO_PRINT.md PP-4/PP-5 — /uploads/print/<name> are the customers' private
// photos and rendered cards. They need more than a sign-in: print.edit within
// the order's scope, or print.print; a staged photo (order not saved yet) only
// its uploader. Never cached by a shared cache.

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** The order (or staged uploader) a print file belongs to, by its name. */
async function printFileOwner(name: string) {
  const uuid = /^(?:card-)?([0-9a-f-]{36})/.exec(name)?.[1];
  if (!uuid) return null;
  if (name.startsWith("card-")) {
    const card = await prisma.orderPrintCard.findFirst({
      where: { renderPath: name },
      select: { kit: { select: { orderId: true } } },
    });
    return card ? { orderId: card.kit.orderId, stagedBy: null } : null;
  }
  const photo = await prisma.orderPrintPhoto.findFirst({
    where: { originalPath: { startsWith: uuid } },
    select: { stagedBy: true, kitId: true, printPath: true, kit: { select: { orderId: true } } },
  });
  if (!photo) return null;
  // Only the files we derive from this row: the original, its preview, the
  // current print file.
  return { orderId: photo.kit?.orderId ?? null, stagedBy: photo.kitId == null ? photo.stagedBy : null };
}

async function servePrintFile(name: string, userId: number, session: Parameters<typeof printReadableOrder>[0]["session"]) {
  const file = printFilePath(name);
  if (!file) return notFound();
  const owner = await printFileOwner(name);
  if (!owner) return notFound();
  const permissions = await getEffectivePermissions(userId);
  if (!permissions.includes("print.edit") && !permissions.includes("print.print")) return notFound();
  if (owner.orderId == null) {
    if (owner.stagedBy !== userId) return notFound();
  } else if (!(await printReadableOrder({ session, permissions }, owner.orderId))) {
    return notFound();
  }
  const ext = name.split(".").pop()!.toLowerCase();
  try {
    const data = await readFile(file);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": UPLOAD_CONTENT_TYPE[ext],
        "Content-Length": String(data.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { path: segments } = await params;
  if (segments.length === 2 && segments[0] === "print") {
    return servePrintFile(segments[1], session.user.id, session);
  }
  // One flat file named by the server — anything else was never written by us.
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
