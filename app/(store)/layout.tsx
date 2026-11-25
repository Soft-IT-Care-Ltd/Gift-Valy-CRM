import type { Metadata, Viewport } from "next";
import { Hind_Siliguri } from "next/font/google";
import { storefrontOrigin } from "@/lib/storefront/hosts";
import "./store.css";

// ROUND3 W-1 — the public website's root layout: its own fonts, theme and
// chrome. Nothing from the ERP's root layout (theme provider, toaster, PWA
// registration, service worker) is loaded here, and nothing here reads the
// staff session. Hind Siliguri renders Bangla product names.

const hind = Hind_Siliguri({
  subsets: ["bengali", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-hind",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(storefrontOrigin()),
  title: { default: "Gift Valy", template: "%s · Gift Valy" },
  description: "Gifts delivered anywhere in Bangladesh.",
  icons: { icon: [{ url: "/shop/logo.png", type: "image/png" }] },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#fffaf5",
  width: "device-width",
  initialScale: 1,
};

export default function StoreRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={hind.variable}>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
