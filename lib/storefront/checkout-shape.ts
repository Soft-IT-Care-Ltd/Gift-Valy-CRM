import { z } from "zod";
import {
  DELIVERY_DATE_MODES,
  DELIVERY_ZONES,
  OCCASIONS,
  RECIPIENT_RELATIONS,
  type DeliveryZoneValue,
} from "@/lib/order-constants";
import { copy } from "./copy";

// ROUND3 W-5 — what the checkout sends and how it is checked. Client- and
// server-safe: the checkout form shows these errors under each field and the
// order endpoint (lib/storefront/place-order.ts) runs the very same checks.
//
// The request carries who, where, which items, which choices and how many.
// The only money in it is what the page SHOWED (each line's seenPrice and the
// seenTotal): the server prices everything from the database and uses these
// only to answer 409 "the price just changed" when they differ. Unknown keys
// (a `unitPrice`, a `total`, a `deliveryCharge`) refuse the request.

/** The sender's country, in the order the owner listed them; the code is the WhatsApp dial code. */
export const WEB_COUNTRIES = [
  { value: "KSA", label: "Saudi Arabia (KSA)", dial: "966", national: [9, 9], example: "5X XXX XXXX" },
  { value: "UAE", label: "United Arab Emirates (UAE)", dial: "971", national: [9, 9], example: "5X XXX XXXX" },
  { value: "Qatar", label: "Qatar", dial: "974", national: [8, 8], example: "XXXX XXXX" },
  { value: "Oman", label: "Oman", dial: "968", national: [8, 8], example: "9XXX XXXX" },
  { value: "Kuwait", label: "Kuwait", dial: "965", national: [8, 8], example: "XXXX XXXX" },
  { value: "Bahrain", label: "Bahrain", dial: "973", national: [8, 8], example: "3XXX XXXX" },
  { value: "Malaysia", label: "Malaysia", dial: "60", national: [9, 10], example: "1X XXX XXXX" },
  { value: "Singapore", label: "Singapore", dial: "65", national: [8, 8], example: "8XXX XXXX" },
  { value: "Italy", label: "Italy", dial: "39", national: [9, 11], example: "3XX XXX XXXX", keepZero: true },
  { value: "UK", label: "United Kingdom", dial: "44", national: [10, 10], example: "7XXX XXXXXX" },
  { value: "USA", label: "United States", dial: "1", national: [10, 10], example: "XXX XXX XXXX" },
  { value: "Bangladesh", label: "Bangladesh", dial: "880", national: [10, 10], example: "1XXX XXXXXX" },
  { value: "Maldives", label: "Maldives", dial: "960", national: [7, 7], example: "7XX XXXX" },
  { value: "Canada", label: "Canada", dial: "1", national: [10, 10], example: "XXX XXX XXXX" },
  { value: "Australia", label: "Australia", dial: "61", national: [9, 9], example: "4XX XXX XXX" },
  { value: "Germany", label: "Germany", dial: "49", national: [10, 11], example: "15X XXXXXXXX" },
  { value: "France", label: "France", dial: "33", national: [9, 9], example: "6 XX XX XX XX" },
  { value: "South Korea", label: "South Korea", dial: "82", national: [9, 10], example: "10 XXXX XXXX" },
  { value: "Japan", label: "Japan", dial: "81", national: [10, 10], example: "90 XXXX XXXX" },
  { value: "Other", label: "Another country", dial: null, national: [6, 13], example: "+code number" },
] as const satisfies readonly {
  value: string;
  label: string;
  dial: string | null;
  national: readonly [number, number];
  example: string;
  keepZero?: boolean;
}[];

export type WebCountry = (typeof WEB_COUNTRIES)[number]["value"];
const COUNTRY_VALUES = WEB_COUNTRIES.map((c) => c.value) as [WebCountry, ...WebCountry[]];
const countryOf = (v: string) => WEB_COUNTRIES.find((c) => c.value === v);

/** Time zone → the likely country (the checkout's starting choice; always editable). */
const ZONE_COUNTRY: Record<string, WebCountry> = {
  "Asia/Riyadh": "KSA",
  "Asia/Dubai": "UAE",
  "Asia/Qatar": "Qatar",
  "Asia/Muscat": "Oman",
  "Asia/Kuwait": "Kuwait",
  "Asia/Bahrain": "Bahrain",
  "Asia/Kuala_Lumpur": "Malaysia",
  "Asia/Kuching": "Malaysia",
  "Asia/Singapore": "Singapore",
  "Europe/Rome": "Italy",
  "Europe/London": "UK",
  "Asia/Dhaka": "Bangladesh",
  "Indian/Maldives": "Maldives",
  "Europe/Berlin": "Germany",
  "Europe/Paris": "France",
  "Asia/Seoul": "South Korea",
  "Asia/Tokyo": "Japan",
};

export function guessCountry(timeZone: string | undefined): WebCountry | "" {
  if (!timeZone) return "";
  if (ZONE_COUNTRY[timeZone]) return ZONE_COUNTRY[timeZone];
  if (timeZone.startsWith("Australia/")) return "Australia";
  if (/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|Regina|St_Johns|Montreal)$/.test(timeZone)) return "Canada";
  if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise)$/.test(timeZone) || timeZone.startsWith("America/Indiana/")) return "USA";
  return "";
}

/** Bangla (০–৯), Arabic (٠–٩) and Persian (۰–۹) digits → 0–9: typed on any phone keyboard, the same number. */
export function toEnglishDigits(s: string): string {
  return s.replace(/[০-৯٠-٩۰-۹]/g, (d) => {
    const c = d.charCodeAt(0);
    if (c >= 0x09e6 && c <= 0x09ef) return String(c - 0x09e6);
    if (c >= 0x0660 && c <= 0x0669) return String(c - 0x0660);
    return String(c - 0x06f0);
  });
}

/**
 * The sender's WhatsApp number → "+<code><number>", or null when it can't be
 * one. The country's code is in front of the field; a leading 0 or the code
 * typed again is dropped. A number typed with + (or 00) is taken as it is —
 * someone in KSA may well use a UAE number. "Other" must carry its code.
 */
export function normalizeSenderWhatsApp(country: string, typed: string): string | null {
  const raw = toEnglishDigits(typed).trim();
  const international = raw.startsWith("+") || raw.startsWith("00");
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("00")) digits = digits.slice(2);
  if (international) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  const c = countryOf(country);
  if (!c?.dial) return null; // "Other": the code is needed
  const [min, max] = c.national;
  const fits = (n: string) => n.length >= min && n.length <= max;
  let national = digits;
  if (digits.startsWith(c.dial) && fits(digits.slice(c.dial.length))) national = digits.slice(c.dial.length);
  else if (!("keepZero" in c && c.keepZero) && digits.startsWith("0") && fits(digits.slice(1))) national = digits.slice(1);
  if (!fits(national) || national.startsWith("0") && !("keepZero" in c && c.keepZero)) return null;
  const full = `${c.dial}${national}`;
  return full.length <= 15 ? `+${full}` : null;
}

/** Every way the ERP may have saved the same number (staff type +966…, 966…, 00966…; a Bangladeshi 01…). */
export function phoneSpellings(e164: string): string[] {
  const digits = e164.replace(/\D/g, "");
  const out = new Set([`+${digits}`, digits, `00${digits}`]);
  if (digits.startsWith("880") && digits.length === 13) out.add(`0${digits.slice(3)}`);
  return [...out];
}

/** A Bangladeshi mobile → "01XXXXXXXXX" (+880 / 880 / Bangla digits accepted), or null. */
export function normalizeBdMobile(typed: string): string | null {
  let d = toEnglishDigits(typed).replace(/\D/g, "");
  if (d.startsWith("880")) d = d.slice(2);
  else if (d.startsWith("88") && d.length === 13) d = d.slice(2);
  if (d.length === 10 && d.startsWith("1")) d = `0${d}`;
  return /^01[3-9]\d{8}$/.test(d) ? d : null;
}

/** "YYYY-MM-DD" of a moment on the Dhaka calendar. */
export function dhakaYmdOf(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** A fixed delivery date may be today (Dhaka) up to a year ahead. */
export const FIXED_DATE_MAX_DAYS = 365;

/** "2026-11-31" or "2026-12-45" are not days (a hand-made request; the date field can't send them). */
export function isCalendarDate(ymd: string): boolean {
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

export function fixedDateRange(now: Date): { min: string; max: string } {
  return { min: dhakaYmdOf(now), max: dhakaYmdOf(new Date(now.getTime() + FIXED_DATE_MAX_DAYS * 86_400_000)) };
}

// ---------- the request ----------

const SLUG = /^[a-z0-9-]{1,80}$/;
export const MAX_ORDER_LINES = 30;
export const MAX_LINE_QTY = 20;

const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max, message);

export const orderLineSchema = z
  .object({
    kind: z.enum(["product", "package"]),
    slug: z.string().regex(SLUG),
    /** choice group key → option key, exactly as the product page gave them. */
    picks: z.record(z.string().regex(/^\d{1,9}$/), z.number().int().positive()),
    qty: z.number().int().min(1).max(MAX_LINE_QTY),
    /** The unit price the page showed (৳). Compared, never used to price. */
    seenPrice: z.number().finite(),
  })
  .strict();

export const orderRequestSchema = z
  .object({
    sender: z
      .object({
        name: text(2, 80, copy.checkout.errors.senderName),
        country: z.enum(COUNTRY_VALUES, { message: copy.checkout.errors.country }),
        whatsapp: z.string().trim().min(1, copy.checkout.errors.whatsapp).max(30, copy.checkout.errors.whatsapp),
      })
      .strict(),
    recipient: z
      .object({
        name: text(2, 80, copy.checkout.errors.recipientName),
        phone: z.string().trim().min(1, copy.checkout.errors.bdPhone).max(30, copy.checkout.errors.bdPhone),
        relation: z.enum(RECIPIENT_RELATIONS).nullable().optional(),
        address: text(10, 300, copy.checkout.errors.address),
        zone: z.enum(DELIVERY_ZONES, { message: copy.checkout.errors.zone }),
      })
      .strict(),
    delivery: z
      .object({
        mode: z.enum(DELIVERY_DATE_MODES, { message: copy.checkout.errors.dateMode }),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      })
      .strict(),
    occasion: z.enum(OCCASIONS).nullable().optional(),
    note: z.string().trim().max(500, copy.checkout.errors.note).optional().default(""),
    lines: z.array(orderLineSchema).min(1, copy.api.bagEmpty).max(MAX_ORDER_LINES),
    /** The total the page showed (items + delivery). Compared, never used. */
    seenTotal: z.number().finite(),
    /** The honeypot: hidden from people, filled in by bots. Must stay empty. */
    website: z.string().max(200).optional().default(""),
  })
  .strict();

export type OrderRequestInput = z.input<typeof orderRequestSchema>;
export type OrderRequest = z.output<typeof orderRequestSchema>;

/** A checked request, with both phone numbers in their stored form. */
export type CheckedOrderRequest = OrderRequest & { whatsapp: string; recipientPhone: string };

/** Field key → message, e.g. "sender.whatsapp" → "Enter …". */
export type FieldErrors = Record<string, string>;

/**
 * The checkout's checks, client and server alike: the schema, both phone
 * numbers, and a fixed date inside today … a year. `ok` carries the request
 * with the stored phone forms.
 */
export function checkOrderRequest(
  raw: unknown,
  now: Date
): { ok: true; value: CheckedOrderRequest } | { ok: false; errors: FieldErrors } {
  const parsed = orderRequestSchema.safeParse(raw);
  const errors: FieldErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path.length >= 2 && issue.path[0] !== "lines" ? `${String(issue.path[0])}.${String(issue.path[1])}` : String(issue.path[0] ?? "form");
      if (!errors[key]) errors[key] = issue.code === "unrecognized_keys" ? copy.api.checkDetails : issue.message;
    }
    return { ok: false, errors };
  }
  const v = parsed.data;
  const whatsapp = normalizeSenderWhatsApp(v.sender.country, v.sender.whatsapp);
  if (!whatsapp) errors["sender.whatsapp"] = copy.checkout.errors.whatsapp;
  const recipientPhone = normalizeBdMobile(v.recipient.phone);
  if (!recipientPhone) errors["recipient.phone"] = copy.checkout.errors.bdPhone;
  if (v.delivery.mode === "FIXED") {
    const { min, max } = fixedDateRange(now);
    if (!v.delivery.date) errors["delivery.date"] = copy.checkout.errors.dateMissing;
    else if (!isCalendarDate(v.delivery.date) || v.delivery.date < min || v.delivery.date > max) {
      errors["delivery.date"] = copy.checkout.errors.dateRange;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { ...v, delivery: { mode: v.delivery.mode, date: v.delivery.mode === "FIXED" ? v.delivery.date! : null }, whatsapp: whatsapp!, recipientPhone: recipientPhone! },
  };
}

/** Σ qty × the item's charge for the zone — the order form's own rule (CORRECTIONS Products §3). */
export function zoneDelivery(
  lines: { qty: number; delivery: { insideDhaka: number; subDhaka: number; outsideDhaka: number } }[],
  zone: DeliveryZoneValue
): number {
  const key = zone === "INSIDE_DHAKA" ? "insideDhaka" : zone === "SUB_DHAKA" ? "subDhaka" : "outsideDhaka";
  return Math.round(lines.reduce((s, l) => s + l.qty * l.delivery[key], 0) * 100) / 100;
}
