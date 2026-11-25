import { existsSync } from "node:fs";
import { publicPhotoFile } from "@/lib/storefront/catalog";
import { parseWebImageName, webImageBytes } from "@/lib/storefront/images";

// ROUND3 W-3 — website photos: /img/<photo>-<360|720|1080>.webp, only for
// photos of shown items (lib/storefront/catalog.ts decides); everything else
// is a plain 404. /uploads stays behind the staff login.

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const parsed = parseWebImageName((await params).file);
  if (!parsed) return notFound();
  const original = await publicPhotoFile(parsed.base);
  if (!original || !existsSync(original)) return notFound();
  try {
    const bytes = await webImageBytes(original, parsed.base, parsed.width);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}
