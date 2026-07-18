// Invoice branding — CORRECTIONS Round 1.5 §R9. Client-safe: no Prisma/server
// imports (shared by the settings form, the API route and the PDF renderer).
//
// One JSON settings row holds everything the invoice letterhead/footer prints.
// Missing/blank fields fall back to the previous hard-coded values so existing
// installs keep rendering identically until Admin edits something.

export const INVOICE_BRANDING_KEY = "invoice_branding";

export interface InvoiceBranding {
  logoUrl: string | null; // uploaded PNG/JPEG under /uploads (null = "GV" placeholder box)
  businessName: string;
  tagline: string; // the line under the name (Bangla welcome)
  address: string;
  phones: string; // free text — "WhatsApp: +880 17.., Hotline: .."
  email: string; // optional ("" = omit)
  social: string; // optional — e.g. facebook.com/giftvaly
  footerText: string; // the one-line terms strip at the slot bottom
  thankYouLine: string; // the closing brand line under the terms
}

// The exact strings the template hard-coded before R9 — the zero-config look.
export const DEFAULT_INVOICE_BRANDING: InvoiceBranding = {
  logoUrl: null,
  businessName: "Gift Valy",
  tagline: "প্রবাসীর ভালোবাসা, প্রিয়জনের দুয়ারে",
  address: "Dhaka, Bangladesh",
  phones: "WhatsApp: +880 1XXX-XXXXXX",
  email: "",
  social: "facebook.com/giftvaly",
  footerText:
    "ডেলিভারির সময় বাকি টাকা (COD) পরিশোধযোগ্য  ·  অর্ডার নিশ্চিত হওয়ার পর অগ্রিম ফেরতযোগ্য নয়  ·  পণ্য গ্রহণের সময় প্যাকেজ খুলে মিলিয়ে নিন  ·  কম্পিউটারে তৈরি ইনভয়েস, স্বাক্ষরের প্রয়োজন নেই",
  thankYouLine: "আপনার ভালোবাসা পৌঁছে দিতে পেরে আমরা আনন্দিত",
};

const str = (v: unknown, fallback: string): string =>
  typeof v === "string" ? v.trim() : fallback;

// Tolerant read of the stored JSON — unknown/missing keys never break a PDF.
export function normalizeInvoiceBranding(raw: unknown): InvoiceBranding {
  const o =
    raw != null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const d = DEFAULT_INVOICE_BRANDING;
  const logo = str(o.logoUrl, "");
  return {
    // Only uploaded files are honoured — never an arbitrary/external path.
    logoUrl: logo.startsWith("/uploads/") ? logo : null,
    businessName: str(o.businessName, d.businessName) || d.businessName,
    tagline: str(o.tagline, d.tagline),
    address: str(o.address, d.address),
    phones: str(o.phones, d.phones),
    email: str(o.email, d.email),
    social: str(o.social, d.social),
    footerText: str(o.footerText, d.footerText),
    thankYouLine: str(o.thankYouLine, d.thankYouLine),
  };
}

// The single contact line under the business name: phones · email · social ·
// address — blank parts drop out.
export function brandingContactLine(b: InvoiceBranding): string {
  return [b.phones, b.email, b.social, b.address]
    .map((p) => p.trim())
    .filter(Boolean)
    .join("  ·  ");
}
