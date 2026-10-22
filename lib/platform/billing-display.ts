import { money } from "@/lib/format";
import type { BillingSnapshot, PlatformState } from "./state-shape";

// FUNNEL_LINER.md GV-8 / GV-9 — the words and numbers the Billing page, the
// reminder banner and the pop-up show. Pure and client-safe. Dates are Dhaka
// days; amounts arrive as integer paisa (GV-4) and are shown as ৳.

export type BillingPlan = BillingSnapshot["plan"];
export type BillingInvoice = BillingSnapshot["invoices"][number];

export const taka = (paisa: number) => money(paisa / 100);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today in Dhaka as YYYY-MM-DD. */
export function dhakaDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Whole Dhaka days from today to `dueOn` (YYYY-MM-DD): 0 on the due date, negative after it. */
export function dhakaDaysLeft(dueOn: string, now: Date = new Date()): number {
  return Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${dhakaDay(now)}T00:00:00Z`)) / DAY_MS);
}

// A YYYY-MM-DD is a calendar day, so it is formatted at UTC noon in UTC —
// the same day whatever the server's or the browser's zone.
const dayOf = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

/** "Fri 7 Nov" */
export function dayLabelEn(ymd: string): string {
  const d = dayOf(ymd);
  const wd = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(d);
  const dm = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
  return `${wd} ${dm}`;
}

/** "শুক্রবার, ৭ নভেম্বর" */
export function dayLabelBn(ymd: string): string {
  return new Intl.DateTimeFormat("bn-BD", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(dayOf(ymd));
}

const bnNumber = (n: number) => new Intl.NumberFormat("bn-BD").format(n);

/** "Oct 2026" for a YYMM period. */
export function periodLabel(yymm: string): string {
  const d = new Date(Date.UTC(2000 + Number(yymm.slice(0, 2)), Number(yymm.slice(2, 4)) - 1, 15));
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

// ---- The estimate (FUNNEL_LINER_ADMIN.md §8 plan) ----
//
// Fixed fee always. Up to `freeUpTo` orders: no order fee. Then the first band
// whose `upTo` covers the count (bands run on from the one before, the first
// from freeUpTo + 1). Past the last band, each further `stepOrders` (or part)
// adds `stepFeePaisa` on top of the last band's fee.

export type BillEstimate = {
  bandLabel: string;
  lines: { label: string; amountPaisa: number }[];
  totalPaisa: number;
};

export function estimateBill(plan: BillingPlan, orders: number): BillEstimate {
  const fixed = { label: "Fixed fee", amountPaisa: plan.fixedFeePaisa };
  const done = (bandLabel: string, feePaisa: number): BillEstimate => {
    const lines = feePaisa > 0 ? [fixed, { label: `Order fee (${bandLabel})`, amountPaisa: feePaisa }] : [fixed];
    return { bandLabel, lines, totalPaisa: lines.reduce((s, l) => s + l.amountPaisa, 0) };
  };

  if (orders <= plan.freeUpTo) return done(`up to ${plan.freeUpTo} orders, no order fee`, 0);

  const bands = [...plan.bands].sort((a, b) => a.upTo - b.upTo);
  let from = plan.freeUpTo + 1;
  for (const band of bands) {
    if (orders <= band.upTo) return done(`${from}–${band.upTo} orders`, band.feePaisa);
    from = band.upTo + 1;
  }

  const last = bands.at(-1);
  const lastUpTo = last?.upTo ?? plan.freeUpTo;
  const lastFee = last?.feePaisa ?? 0;
  if (!plan.stepOrders || !plan.stepFeePaisa) return done(`over ${lastUpTo} orders`, lastFee);
  const steps = Math.ceil((orders - lastUpTo) / plan.stepOrders);
  const stepFrom = lastUpTo + (steps - 1) * plan.stepOrders + 1;
  const stepTo = lastUpTo + steps * plan.stepOrders;
  return done(`${stepFrom}–${stepTo} orders`, lastFee + steps * plan.stepFeePaisa);
}

/** The invoice the page calls "current": the newest issued one. */
export function currentInvoice(snapshot: BillingSnapshot | null): BillingInvoice | null {
  if (!snapshot || snapshot.invoices.length === 0) return null;
  return [...snapshot.invoices].sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.number.localeCompare(a.number))[0];
}

// ---- The status line ----

export type BillingStatus = {
  tone: "ok" | "due" | "last-day" | "suspended";
  en: string;
  bn: string;
};

export function billingStatus(
  state: PlatformState,
  invoice: BillingInvoice | null,
  now: Date = new Date()
): BillingStatus {
  if (state.state === "suspended") {
    const since = state.changedAt ? dhakaDay(new Date(state.changedAt)) : null;
    return {
      tone: "suspended",
      en: since
        ? `Suspended since ${dayLabelEn(since)} — pay to open the dashboard`
        : "Suspended — pay to open the dashboard",
      bn: since
        ? `${dayLabelBn(since)} থেকে ড্যাশবোর্ড বন্ধ — খুলতে বিল পরিশোধ করুন`
        : "ড্যাশবোর্ড বন্ধ — খুলতে বিল পরিশোধ করুন",
    };
  }
  const dueOn = state.state === "past_due" ? (state.dueOn ?? invoice?.dueOn ?? null) : null;
  if (!dueOn) return { tone: "ok", en: "All paid", bn: "সব বিল পরিশোধ করা হয়েছে" };
  return dueWords(dueOn, now);
}

/** "Bill due by Fri 7 Nov — 3 days left" + Bangla; red on (and after) the due date. */
function dueWords(dueOn: string, now: Date): BillingStatus {
  const left = dhakaDaysLeft(dueOn, now);
  const en = dayLabelEn(dueOn);
  const bn = dayLabelBn(dueOn);
  if (left > 0) {
    return {
      tone: "due",
      en: `Bill due by ${en} — ${left} ${left === 1 ? "day" : "days"} left`,
      bn: `বিল পরিশোধের শেষ দিন ${bn} — আর ${bnNumber(left)} দিন বাকি`,
    };
  }
  if (left === 0) {
    return {
      tone: "last-day",
      en: `Bill due by ${en} — today is the last day`,
      bn: `বিল পরিশোধের শেষ দিন ${bn} — আজই শেষ দিন`,
    };
  }
  return {
    tone: "last-day",
    en: `Bill was due on ${en} — please pay now`,
    bn: `বিল পরিশোধের শেষ দিন ছিল ${bn} — এখনই পরিশোধ করুন`,
  };
}

// ---- GV-9 reminder (banner + pop-up) ----

export type BillingReminder = { tone: "due" | "last-day"; en: string; bn: string };

/** Null unless the state is past_due with a due date. `amountDue` is shown as Funnel Liner sent it. */
export function billingReminder(state: PlatformState, now: Date = new Date()): BillingReminder | null {
  if (state.state !== "past_due" || !state.dueOn) return null;
  const left = dhakaDaysLeft(state.dueOn, now);
  const amount = state.amountDue ? ` of ${state.amountDue}` : "";
  const amountBn = state.amountDue ? ` ${state.amountDue}` : "";
  const en = dayLabelEn(state.dueOn);
  const bn = dayLabelBn(state.dueOn);
  if (left > 0) {
    return {
      tone: "due",
      en: `Your Funnel Liner bill${amount} is due by ${en} — ${left} ${left === 1 ? "day" : "days"} left.`,
      bn: `আপনার Funnel Liner বিল${amountBn} ${bn} এর মধ্যে পরিশোধ করতে হবে — আর ${bnNumber(left)} দিন বাকি।`,
    };
  }
  return {
    tone: "last-day",
    en:
      left === 0
        ? `Your Funnel Liner bill${amount} is due by ${en} — today is the last day.`
        : `Your Funnel Liner bill${amount} was due on ${en} — please pay now.`,
    bn:
      left === 0
        ? `আপনার Funnel Liner বিল${amountBn} পরিশোধের আজই শেষ দিন (${bn})।`
        : `আপনার Funnel Liner বিল${amountBn} পরিশোধের শেষ দিন ছিল ${bn} — এখনই পরিশোধ করুন।`,
  };
}

/** Settings key remembering the Dhaka day the Admin last saw the pop-up (GV-9). */
export const reminderSeenKey = (userId: number) => `billing_reminder_seen:${userId}`;
