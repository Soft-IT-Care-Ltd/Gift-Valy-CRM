import type { Metadata, Viewport } from "next";
import {
  Inter,
  Space_Grotesk,
  JetBrains_Mono,
  Hind_Siliguri,
  Caveat,
} from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { LEGACY_POLYFILLS } from "@/lib/legacy-polyfills";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { PwaRegister } from "@/components/pwa-register";

// Body / UI
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Display / headings
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space",
  display: "swap",
});

// Monospace — money, IDs, tabular figures
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
});

// Bangla-first typography
const hindSiliguri = Hind_Siliguri({
  subsets: ["bengali", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-hind",
  display: "swap",
});

// Handwritten accent
const caveat = Caveat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-caveat",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Gift Valy — Business Management",
  description: "ERP/CRM for Gift Valy",
  // PWA (SPEC §16 Phase 4): installable on Android (manifest.ts) and iOS
  // (apple-touch-icon + web-app meta below).
  applicationName: "Gift Valy",
  appleWebApp: {
    capable: true,
    title: "Gift Valy",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "h-full antialiased font-sans",
        inter.variable,
        spaceGrotesk.variable,
        jetbrainsMono.variable,
        hindSiliguri.variable,
        caveat.variable
      )}
    >
      <body className="min-h-full flex flex-col">
        {/* Must run before any bundle chunk — see lib/legacy-polyfills.ts */}
        <script dangerouslySetInnerHTML={{ __html: LEGACY_POLYFILLS }} />
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster richColors position="top-center" />
          <PwaRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
