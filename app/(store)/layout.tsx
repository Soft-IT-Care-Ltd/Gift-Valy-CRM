import type { Metadata, Viewport } from "next";
import { Baloo_Da_2, Hind_Siliguri } from "next/font/google";
import { MetaPixel } from "@/components/storefront/meta-pixel";
import { StoreFooter } from "@/components/storefront/store-footer";
import { StoreHeader } from "@/components/storefront/store-header";
import { cachedPixelId } from "@/lib/storefront/cached";
import { copy } from "@/lib/storefront/copy";
import { storefrontOrigin } from "@/lib/storefront/hosts";
import { SHARE_IMAGE, STORE_MANIFEST_PATH, STORE_THEME_COLOR } from "@/lib/storefront/seo";
import "./store.css";

// ROUND3 W-1/W-4 — the public website's root layout: its own fonts, theme
// and chrome. Nothing from the ERP's root layout (theme provider, toaster,
// PWA registration, service worker) is loaded here, and nothing here reads
// the staff session. Fonts are self-hosted by next/font (no request to
// Google from a visitor's phone); both render Bangla product names.
//
// W-8: every page's link preview (Facebook, WhatsApp) falls back to the
// branded 1200 × 630 share image; the Meta Pixel loads only while tracking is
// on (Settings → Website → Meta Pixel).
//
// W-10 follow-up: the website links its own web app manifest (name, navy,
// its own icon — lib/storefront/seo.ts), never the ERP's, which is a 404 on
// the website host.

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
  title: { default: copy.meta.homeTitle, template: copy.meta.titleTemplate },
  description: copy.brand.tagline,
  applicationName: copy.brand.name,
  openGraph: { type: "website", siteName: copy.brand.name, locale: "en_US", images: [{ ...SHARE_IMAGE, alt: copy.brand.name }] },
  twitter: { card: "summary_large_image", images: [SHARE_IMAGE.url] },
  icons: { icon: [{ url: "/shop/icon.png", type: "image/png" }], apple: [{ url: "/shop/icon.png" }] },
  formatDetection: { telephone: false },
  manifest: STORE_MANIFEST_PATH,
};

export const viewport: Viewport = {
  themeColor: STORE_THEME_COLOR,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function StoreRootLayout({ children }: { children: React.ReactNode }) {
  const pixelId = await cachedPixelId();
  return (
    <html lang={copy.lang} className={`${hind.variable} ${baloo.variable}`}>
      <body className="flex min-h-screen flex-col antialiased">
        <StoreHeader />
        <main className="flex-1">{children}</main>
        <StoreFooter />
        <MetaPixel pixelId={pixelId} />
      </body>
    </html>
  );
}
