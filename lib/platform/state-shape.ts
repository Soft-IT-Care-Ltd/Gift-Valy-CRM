import { z } from "zod";

// FUNNEL_LINER.md GV-3 — the billing state Funnel Liner pushes. Pure, so the
// server, the coming proxy gate (GV-7) and the browser (GV-9 banner) share
// it. The ERP never moves by itself: with nothing ever pushed it is "active".

export const PLATFORM_STATES = ["active", "past_due", "suspended"] as const;
export type PlatformStateName = (typeof PLATFORM_STATES)[number];

export type PlatformState = {
  state: PlatformStateName;
  /** Shown to the Admin only. */
  message: string | null;
  /** As Funnel Liner sent it (e.g. "৳3,800") — shown on the banner, never computed here. */
  amountDue: string | null;
  /** YYYY-MM-DD */
  dueOn: string | null;
  /** When Funnel Liner sent the push this state came from (ISO). An older push is ignored. */
  sentAt: string | null;
  /** When the state last CHANGED here (ISO) — a repeat of the same state keeps it. */
  changedAt: string | null;
};

export const ACTIVE_STATE: PlatformState = {
  state: "active",
  message: null,
  amountDue: null,
  dueOn: null,
  sentAt: null,
  changedAt: null,
};

/** The settings keys (no new table). */
export const PLATFORM_STATE_KEY = "platform_state";
export const PLATFORM_BILLING_KEY = "platform_billing";

export const FUNNEL_LINER_ACTOR = "Funnel Liner";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const sentAt = z.iso.datetime({ offset: true });

export const platformPushSchema = z.object({
  state: z.enum(PLATFORM_STATES),
  message: z.string().trim().max(500).nullish(),
  amountDue: z.string().trim().max(40).nullish(),
  dueOn: isoDay.nullish(),
  sentAt,
});
export type PlatformPush = z.infer<typeof platformPushSchema>;

const storedStateSchema = z.object({
  state: z.enum(PLATFORM_STATES),
  message: z.string().nullable(),
  amountDue: z.string().nullable(),
  dueOn: z.string().nullable(),
  sentAt: z.string().nullable(),
  changedAt: z.string().nullable(),
});

/** The stored settings value → a state; anything unreadable is "active" (the ERP never locks itself). */
export function parseStoredState(raw: unknown): PlatformState {
  const parsed = storedStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : ACTIVE_STATE;
}

/** True unless the stored push is newer — a late retry can never undo a newer one. */
export function isNewerPush(storedSentAt: string | null | undefined, pushSentAt: string): boolean {
  if (!storedSentAt) return true;
  return Date.parse(pushSentAt) >= Date.parse(storedSentAt);
}

// ---- GV-4 billing snapshot (FUNNEL_LINER_ADMIN.md §8) ----

const paisa = z.number().int().nonnegative().max(1_000_000_000_00);
const yymm = z.string().regex(/^\d{2}(0[1-9]|1[0-2])$/, "YYMM");
const label = z.string().trim().min(1).max(120);

export const billingSnapshotSchema = z.object({
  sentAt,
  plan: z.object({
    fixedFeePaisa: paisa,
    freeUpTo: z.number().int().nonnegative(),
    bands: z
      .array(z.object({ upTo: z.number().int().positive(), feePaisa: paisa }))
      .max(50),
    stepOrders: z.number().int().positive().nullish(),
    stepFeePaisa: paisa.nullish(),
  }),
  invoices: z
    .array(
      z.object({
        number: z.string().trim().min(1).max(40),
        period: yymm,
        issuedOn: isoDay,
        dueOn: isoDay,
        ordersCreated: z.number().int().nonnegative(),
        lastOrderNo: z.string().trim().max(40).nullish(),
        lines: z.array(z.object({ label, amountPaisa: paisa })).max(30),
        totalPaisa: paisa,
        paidPaisa: paisa,
        duePaisa: paisa,
        status: z.string().regex(/^[a-z_]{1,30}$/, "status is a lower-case word"),
      })
    )
    .max(12, "At most 12 invoices"),
  payTo: z
    .strictObject({
      bkash: z.string().trim().max(40).nullish(),
      bank: z.string().trim().max(500).nullish(),
      note: z.string().trim().max(500).nullish(),
    })
    .nullish(),
});
export type BillingSnapshot = z.infer<typeof billingSnapshotSchema>;

/** The stored snapshot, or null when none was ever pushed (or it is unreadable). */
export function parseStoredBilling(raw: unknown): BillingSnapshot | null {
  const parsed = billingSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
