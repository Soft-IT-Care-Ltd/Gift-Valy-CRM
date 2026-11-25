import { createHash } from "node:crypto";

// ROUND3 W-8 — the customer data Meta matches an event to a person with.
// THIS is the only place `user_data` is made, and everything in it that
// identifies a person is SHA-256 hashed here, the way Meta asks (normalised
// first): the phone as digits with its country code, the name lower-case
// without spaces or punctuation, the country as its two-letter code. The raw
// phone and name come in and never go out. fbp / fbc (Meta's own cookies),
// the IP and the browser are sent as they are, as Meta requires.
//
// Whose data: only the SENDER's — the person abroad who placed the order on
// the website, the one who saw the ad. The recipient in Bangladesh (name,
// BD phone, address) is someone else and is never read for Meta at all.

export type MetaUserData = {
  ph?: string[];
  fn?: string[];
  ln?: string[];
  country?: string[];
  external_id?: string[];
  fbp?: string;
  fbc?: string;
  client_ip_address?: string;
  client_user_agent?: string;
};

export const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const BN = "০১২৩৪৫৬৭৮৯";

/** "+966 51 234 5678" → "966512345678" (Meta: country code, digits only). Null when it can't be a phone. */
export function metaPhone(phone: string): string | null {
  const digits = phone.replace(/[০-৯]/g, (d) => String(BN.indexOf(d))).replace(/\D/g, "").replace(/^00/, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** Meta's name rule: lower case, no punctuation, symbols or spaces; Bangla letters kept (UTF-8). */
export function metaNamePart(part: string): string {
  return part.normalize("NFC").toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
}

/** "Rahim Uddin Ahmed" → first "rahim", last "uddinahmed"; one word → first name only. */
export function splitName(name: string): { first: string | null; last: string | null } {
  const words = name.trim().split(/\s+/).map(metaNamePart).filter(Boolean);
  if (words.length === 0) return { first: null, last: null };
  return { first: words[0], last: words.length > 1 ? words.slice(1).join("") : null };
}

/** The checkout's countries (lib/storefront/checkout-shape.ts) → ISO 3166-1 alpha-2, as Meta wants it. "Other" → none. */
export const COUNTRY_ISO: Record<string, string> = {
  KSA: "sa",
  UAE: "ae",
  Qatar: "qa",
  Oman: "om",
  Kuwait: "kw",
  Bahrain: "bh",
  Malaysia: "my",
  Singapore: "sg",
  Italy: "it",
  UK: "gb",
  USA: "us",
  Bangladesh: "bd",
  Maldives: "mv",
  Canada: "ca",
  Australia: "au",
  Germany: "de",
  France: "fr",
  "South Korea": "kr",
  Japan: "jp",
};

const FBP = /^fb\.\d\.\d{10,13}\.\d{1,25}$/;
const FBC = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{8,500}$/;

/** The browser's Meta cookies, only when they look like Meta's own (anything else is dropped). */
export const cleanFbp = (v: string | null | undefined): string | null => (v && FBP.test(v) ? v : null);
export const cleanFbc = (v: string | null | undefined): string | null => (v && FBC.test(v) ? v : null);

export function buildUserData(input: {
  /** The sender's WhatsApp (+<code><number>). */
  phone?: string | null;
  name?: string | null;
  /** The checkout's country value ("KSA", "UK", …). */
  country?: string | null;
  customerId?: number | null;
  fbp?: string | null;
  fbc?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): MetaUserData {
  const out: MetaUserData = {};
  const ph = input.phone ? metaPhone(input.phone) : null;
  if (ph) out.ph = [sha256(ph)];
  if (input.name) {
    const { first, last } = splitName(input.name);
    if (first) out.fn = [sha256(first)];
    if (last) out.ln = [sha256(last)];
  }
  const iso = input.country ? COUNTRY_ISO[input.country] : undefined;
  if (iso) out.country = [sha256(iso)];
  if (input.customerId) out.external_id = [sha256(`giftvaly-customer:${input.customerId}`)];
  const fbp = cleanFbp(input.fbp);
  if (fbp) out.fbp = fbp;
  const fbc = cleanFbc(input.fbc);
  if (fbc) out.fbc = fbc;
  if (input.ip) out.client_ip_address = input.ip.slice(0, 64);
  if (input.userAgent) out.client_user_agent = input.userAgent.slice(0, 500);
  return out;
}
