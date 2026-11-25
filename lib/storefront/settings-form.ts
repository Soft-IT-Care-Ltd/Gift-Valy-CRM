import { z } from "zod";
import { unknownPlaceholders } from "./chat";
import {
  cleanFacebookUrl,
  cleanMessengerPage,
  normalizeWebOrderRules,
  normalizeWebSettings,
  ORDER_MESSAGE_PLACEHOLDERS,
  POLICY_KINDS,
  PRODUCT_MESSAGE_PLACEHOLDERS,
  type PolicyKind,
  type WebOrderRules,
  type WebSettings,
} from "./settings-shape";

// ROUND3 W-7 — Settings → Website, the form (Admin only, settings.manage).
// One schema, used by the form in the browser and by PUT
// /api/settings/website: what the owner types is checked and turned into
// what the website reads (lib/storefront/settings-shape.ts). The whole value
// is stored in the one `website_settings` row — the public settings AND the
// order rules (limits, count for targets), which the website never receives
// (normalizeWebSettings leaves them out). Client-safe.

export type WebsiteSettingsForm = WebSettings & {
  orderLimits: { phonePerHour: number; ipPerHour: number };
  countForTargets: boolean;
};

/** What the form starts with: the stored row read the same tolerant way the website reads it. */
export function websiteSettingsForm(raw: unknown): WebsiteSettingsForm {
  const rules: WebOrderRules = normalizeWebOrderRules(raw);
  return {
    ...normalizeWebSettings(raw),
    orderLimits: { phonePerHour: rules.phonePerHour, ipPerHour: rules.ipPerHour },
    countForTargets: rules.countForTargets,
  };
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const latinDigits = (v: string) => v.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

/**
 * The shop's WhatsApp, typed any way ("01711-223344", "+880 1711 223344",
 * "1711223344", Bangla digits) → 8801XXXXXXXXX. "" stays "" (no button);
 * anything that isn't a Bangladeshi mobile → null.
 */
export function shopWhatsApp(typed: string): string | null {
  if (typed.trim() === "") return "";
  const digits = latinDigits(typed).replace(/\D/g, "");
  const n = digits.startsWith("880") ? digits : digits.startsWith("0") ? `88${digits}` : digits.length === 10 ? `880${digits}` : digits;
  return /^8801[3-9]\d{8}$/.test(n) ? n : null;
}

/**
 * The Facebook Page for Messenger, typed as a username ("giftvaly",
 * "@giftvaly") or any m.me / facebook.com link → the username (or the numeric
 * id of a profile.php link). "" stays ""; anything else → null.
 */
export function shopMessengerPage(typed: string): string | null {
  const v = typed.trim();
  if (v === "") return "";
  let candidate = v;
  if (/^(https?:\/\/)?([a-z]+\.)?(m\.me|facebook\.com|fb\.com|messenger\.com)\//i.test(v)) {
    try {
      const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
      const id = u.searchParams.get("id");
      const parts = u.pathname.split("/").filter(Boolean);
      candidate = u.pathname.startsWith("/profile.php") && id ? id : (parts[0] === "t" ? parts[1] : parts[0]) ?? "";
    } catch {
      return null;
    }
  }
  const page = cleanMessengerPage(candidate);
  return page === "" ? null : page;
}

const text = (max: number) => z.string().trim().max(max, `At most ${max} characters`);

const template = (allowed: readonly string[], label: string) =>
  z
    .string()
    .trim()
    .min(1, `Write the ${label} (it can't be empty)`)
    .max(1000, "At most 1,000 characters")
    .superRefine((v, ctx) => {
      const unknown = unknownPlaceholders(v).concat(
        [...v.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((p) => !allowed.includes(p)).map((p) => `{${p}}`)
      );
      const bad = [...new Set(unknown)];
      if (bad.length) {
        ctx.addIssue({ code: "custom", message: `${bad.join(", ")} can't be used here — use only ${allowed.map((p) => `{${p}}`).join(" ")}` });
      }
    });

/** The policy drafts mark what the owner must fill in as [[…]] — a text still holding one never reaches the website. */
export const POLICY_PLACEHOLDER = "[[";
const policy = text(20_000).refine((v) => !v.includes(POLICY_PLACEHOLDER), "Fill in every [[…]] first — the website must not show them");

const count = (min: number, max: number) =>
  z.coerce.number().int("Whole numbers only").min(min, `At least ${min}`).max(max, `At most ${max}`);

export const websiteSettingsSchema = z.object({
  websiteOn: z.boolean(),
  hotline: text(60),
  whatsapp: z
    .string()
    .max(40)
    .transform((v, ctx) => {
      const n = shopWhatsApp(v);
      if (n === null) {
        ctx.addIssue({ code: "custom", message: "Use a Bangladeshi mobile number, e.g. 01711-223344" });
        return z.NEVER;
      }
      return n;
    }),
  messengerPage: z
    .string()
    .max(300)
    .transform((v, ctx) => {
      const page = shopMessengerPage(v);
      if (page === null) {
        ctx.addIssue({ code: "custom", message: "Use the Facebook Page's username (giftvaly) or its m.me link" });
        return z.NEVER;
      }
      return page;
    }),
  facebookUrl: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || cleanFacebookUrl(v) === v, "Use the Page's full link, e.g. https://facebook.com/giftvaly"),
  officeAddress: text(300),
  deliveryTimes: z.object({ insideDhaka: text(60), subDhaka: text(60), outsideDhaka: text(60) }),
  productMessage: template(PRODUCT_MESSAGE_PLACEHOLDERS, "product message"),
  orderMessage: template(ORDER_MESSAGE_PLACEHOLDERS, "order message"),
  policies: z.object(Object.fromEntries(POLICY_KINDS.map((k) => [k, policy])) as Record<PolicyKind, typeof policy>),
  approxCurrency: z.boolean(),
  homeSeo: z.object({ title: text(70), description: text(200) }),
  orderLimits: z.object({ phonePerHour: count(1, 50), ipPerHour: count(1, 1000) }),
  countForTargets: z.boolean(),
});

export type WebsiteSettingsInput = z.input<typeof websiteSettingsSchema>;

/** The first problem per field, keyed by its path ("policies.privacy"), for the form. */
export function settingsErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
