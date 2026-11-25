// ROUND3 W-5/W-6 — website orders in the ERP. Client-safe constants: the
// order page's Website panel, the Orders list and the API routes share them.

/** Why an SE got a website order (orders.web_assign_reason). */
export const WEBSITE_ASSIGN_REASONS = ["OWN_CUSTOMER", "ON_DUTY", "NOBODY_IN", "MANUAL"] as const;
export type WebsiteAssignReason = (typeof WEBSITE_ASSIGN_REASONS)[number];

export const WEBSITE_ASSIGN_REASON_LABELS: Record<WebsiteAssignReason, string> = {
  OWN_CUSTOMER: "Repeat customer — their own Sales Executive",
  ON_DUTY: "Next in turn among those checked in",
  NOBODY_IN: "Nobody was checked in — next in turn among all Sales Executives",
  MANUAL: "Assigned by hand",
};

/** A website order is cancelled with one of these; each sets the lead LOST with its reason. */
export const WEBSITE_CANCEL_REASONS = [
  { value: "FAKE_ORDER", label: "Fake order", lostReason: "FAKE_ORDER" },
  { value: "UNREACHABLE", label: "Unreachable", lostReason: "NO_RESPONSE" },
  { value: "CHANGED_MIND", label: "Changed mind", lostReason: "CHANGED_MIND" },
  { value: "DUPLICATE", label: "Duplicate", lostReason: "DUPLICATE" },
] as const;

export type WebsiteCancelReason = (typeof WEBSITE_CANCEL_REASONS)[number]["value"];
export const WEBSITE_CANCEL_REASON_VALUES = WEBSITE_CANCEL_REASONS.map((r) => r.value) as [
  WebsiteCancelReason,
  ...WebsiteCancelReason[],
];

/** orders.web_flags — shown to the SE, never refuse the order. */
export const WEBSITE_FLAG_LABELS: Record<string, string> = {
  LIKELY_DUPLICATE: "Likely a duplicate — the same number ordered the same items in the last 30 minutes",
};

/** What the customer typed at checkout (orders.web_contact). */
export type WebContact = {
  sender: { name: string; country: string; whatsapp: string; whatsappTyped: string };
  recipient: { name: string; phone: string; phoneTyped: string; relation: string | null; address: string; zone: string };
  delivery: { mode: string; date: string | null };
  occasion: string | null;
  note: string;
};

/** The Orders list's virtual tab for website drafts ("Needs confirmation"). */
export const WEBSITE_TAB = "WEBSITE";
