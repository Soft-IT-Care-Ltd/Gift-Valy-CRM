import type { Metadata, Viewport } from "next";
import { Baloo_Da_2, Hind_Siliguri } from "next/font/google";
import { StoreFooter } from "@/components/storefront/store-footer";
import { StoreHeader } from "@/components/storefront/store-header";
import { copy } from "@/lib/storefront/copy";
import { storefrontOrigin } from "@/lib/storefront/hosts";
import "./store.css";

// ROUND3 W-1/W-4 — the public website's root layout: its own fonts, theme
// and chrome. Nothing from the ERP's root layout (theme provider, toaster,
// PWA registration, service worker) is loaded here, and nothing here reads
// the staff session. Fonts are self-hosted by next/font (no request to
// Google from a visitor's phone); both render Bangla product names.

const hind = Hind_Siliguri({
  subsets: ["bengali", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-hind",
  display: "swap",
});

const baloo = Baloo_Da_2({
  subsets: ["bengali", "latin"],
  weight: ["600", "700"],
  variable: "--font-baloo",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(storefrontOrigin()),
  title: { default: `${copy.brand.name} — gifts delivered anywhere in Bangladesh`, template: copy.meta.titleTemplate },
  description: copy.brand.tagline,
  applicationName: copy.brand.name,
  openGraph: { type: "website", siteName: copy.brand.name, images: [{ url: "/shop/icon.png", width: 512, height: 512 }] },
  icons: { icon: [{ url: "/shop/icon.png", type: "image/png" }], apple: [{ url: "/shop/icon.png" }] },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#2c347c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function StoreRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={copy.lang} className={`${hind.variable} ${baloo.variable}`}>
      <body className="flex min-h-screen flex-col antialiased">
        <StoreHeader />
        <main className="flex-1">{children}</main>
        <StoreFooter />
      </body>
    </html>
  );
}
