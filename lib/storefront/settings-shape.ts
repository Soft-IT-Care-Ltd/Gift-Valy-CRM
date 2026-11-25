// ROUND3 W-4 — what the website reads from Settings → Website. One JSON row
// in the settings table (key `website_settings`); W-7 adds the Admin editor
// and its audit. Client-safe: no Prisma or server imports.
//
// A missing row or field means "not set": no WhatsApp number = no "Order on
// WhatsApp" button, no Messenger page = no Messenger button, an empty policy =
// no policy page. The read is tolerant — a bad value is dropped, never shown.

export const WEBSITE_SETTINGS_KEY = "website_settings";

export const POLICY_KINDS = ["delivery", "refund", "privacy", "terms"] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];
export const POLICY_TITLES: Record<PolicyKind, string> = {
  delivery: "Delivery policy",
  refund: "Refund & return policy",
  privacy: "Privacy policy",
  terms: "Terms & conditions",
};

/** The placeholders a product message may use (W-7 refuses any other). */
export const MESSAGE_PLACEHOLDERS = ["product", "choices", "price", "link", "order_ref", "total"] as const;
export type MessagePlaceholder = (typeof MESSAGE_PLACEHOLDERS)[number];

export const DEFAULT_PRODUCT_MESSAGE =
  "Hi Gift Valy! I'd like to order:\n{product}\n{choices}\nPrice: {price}\n{link}";

export interface WebSettings {
  /** WhatsApp for wa.me, 8801XXXXXXXXX; "" = no WhatsApp button. */
  whatsapp: string;
  /** Facebook Page username / id for m.me; "" = no Messenger button. */
  messengerPage: string;
  /** https://facebook.com/… or "". */
  facebookUrl: string;
  /** The contact number shown in the footer (free text, e.g. "+880 1711-000000"). */
  hotline: string;
  officeAddress: string;
  /** Delivery time per zone ("Same day", "1–2 days"); "" = not said. */
  deliveryTimes: { insideDhaka: string; subDhaka: string; outsideDhaka: string };
  /** The WhatsApp / Messenger message template for a product or package. */
  productMessage: string;
  policies: Record<PolicyKind, string>;
  /** Show "≈ SAR 120 (approx.)" from the currency rates. Off by default. */
  approxCurrency: boolean;
}

export const DEFAULT_WEB_SETTINGS: WebSettings = {
  whatsapp: "",
  messengerPage: "",
  facebookUrl: "",
  hotline: "",
  officeAddress: "",
  deliveryTimes: { insideDhaka: "", subDhaka: "", outsideDhaka: "" },
  productMessage: DEFAULT_PRODUCT_MESSAGE,
  policies: { delivery: "", refund: "", privacy: "", terms: "" },
  approxCurrency: false,
};

const obj = (v: unknown): Record<string, unknown> =>
  v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** 8801XXXXXXXXX only (W-7 normalises what the owner types into this). */
export function cleanWhatsApp(v: unknown): string {
  const digits = typeof v === "string" ? v.replace(/\D/g, "") : "";
  return /^8801[3-9]\d{8}$/.test(digits) ? digits : "";
}

/** A Page username or numeric id m.me can open. */
export function cleanMessengerPage(v: unknown): string {
  const s = text(v, 80).replace(/^@/, "");
  return /^[A-Za-z0-9.\-_]{2,80}$/.test(s) ? s : "";
}

function cleanFacebookUrl(v: unknown): string {
  const s = text(v, 200);
  return /^https:\/\/(www\.|m\.)?facebook\.com\/[^\s"<>]+$/i.test(s) ? s : "";
}

export function normalizeWebSettings(raw: unknown): WebSettings {
  const o = obj(raw);
  const times = obj(o.deliveryTimes);
  const policies = obj(o.policies);
  const message = text(o.productMessage, 1000);
  return {
    whatsapp: cleanWhatsApp(o.whatsapp),
    messengerPage: cleanMessengerPage(o.messengerPage),
    facebookUrl: cleanFacebookUrl(o.facebookUrl),
    hotline: text(o.hotline, 60),
    officeAddress: text(o.officeAddress, 300),
    deliveryTimes: {
      insideDhaka: text(times.insideDhaka, 60),
      subDhaka: text(times.subDhaka, 60),
      outsideDhaka: text(times.outsideDhaka, 60),
    },
    productMessage: message || DEFAULT_PRODUCT_MESSAGE,
    policies: {
      delivery: text(policies.delivery, 20_000),
      refund: text(policies.refund, 20_000),
      privacy: text(policies.privacy, 20_000),
      terms: text(policies.terms, 20_000),
    },
    approxCurrency: o.approxCurrency === true,
  };
}
