import { storeManifest } from "@/lib/storefront/seo";

// W-10 follow-up — the website's own web app manifest (lib/storefront/seo.ts),
// at /site.webmanifest on the website host; the store's root layout links it.
// Never the ERP's /manifest.webmanifest (app/manifest.ts), which stays a 404
// here. No database, nothing from the ERP.
export function GET() {
  return new Response(JSON.stringify(storeManifest()), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
