import type { MetadataRoute } from "next";

// PWA manifest (SPEC §16 Phase 4 — mobile PWA). Next serves this at
// /manifest.webmanifest and links it from every page automatically, so the
// team can "Add to Home Screen" and use the app full-screen like a native one.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gift Valy — Business Management",
    short_name: "Gift Valy",
    description:
      "Gift Valy ERP/CRM — leads, orders, invoices, stock, delivery, accounts",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#7c3aed",
    orientation: "portrait",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
