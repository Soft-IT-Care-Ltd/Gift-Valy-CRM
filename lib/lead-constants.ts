// Lead Management constants — SPEC §3.
// Client-safe: no Prisma/server imports (used by forms, tables and API routes).

export const LEAD_SOURCES = [
  "FACEBOOK_AD",
  "MESSENGER",
  "WHATSAPP",
  "INSTAGRAM",
  "REFERRAL",
  "REPEAT_CUSTOMER",
  "OTHER",
] as const;

export type LeadSourceValue = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSourceValue, string> = {
  FACEBOOK_AD: "Facebook Ad",
  MESSENGER: "Messenger",
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
  REFERRAL: "Referral",
  REPEAT_CUSTOMER: "Repeat Customer",
  OTHER: "Other",
};

// COMMITTED (CORRECTIONS Leads §9): verbal confirmation + promised advance,
// payment not yet in hand — sits between NEGOTIATING and CONVERTED and feeds
// the Committed queue (chase until the money lands).
export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "FOLLOW_UP",
  "NEGOTIATING",
  "COMMITTED",
  "CONVERTED",
  "LOST",
] as const;

export type LeadStatusValue = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatusValue, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  FOLLOW_UP: "Follow-up",
  NEGOTIATING: "Negotiating",
  COMMITTED: "Committed",
  CONVERTED: "Converted",
  LOST: "Lost",
};

// Terminal states — a lead here is off the active funnel. CONVERTED is set only
// by the auto-convert hook (§3.2); LOST is the manual dead-end. Neither shows
// in follow-up reminders and neither is manually re-openable from the UI.
export const TERMINAL_LEAD_STATUSES: LeadStatusValue[] = ["CONVERTED", "LOST"];

export function leadIsOpen(status: LeadStatusValue): boolean {
  return !TERMINAL_LEAD_STATUSES.includes(status);
}

// Live-funnel statuses (New … Negotiating) — the set that surfaces in follow-up
// reminders and counts toward the active pipeline.
export const OPEN_LEAD_STATUSES: LeadStatusValue[] =
  LEAD_STATUSES.filter(leadIsOpen);

// SPEC §3.1 — status the SE may set by hand. CONVERTED is excluded (system-only,
// happens when an order is created from the lead), so the entry/edit forms never
// offer it.
export const MANUAL_LEAD_STATUSES: LeadStatusValue[] = LEAD_STATUSES.filter(
  (s) => s !== "CONVERTED"
);

export const LOST_REASONS = [
  "PRICE",
  "TRUST",
  "DELIVERY_TIME",
  "OUT_OF_AREA",
  "NO_RESPONSE",
  "OTHER",
] as const;

export type LostReasonValue = (typeof LOST_REASONS)[number];

export const LOST_REASON_LABELS: Record<LostReasonValue, string> = {
  PRICE: "Price",
  TRUST: "Trust",
  DELIVERY_TIME: "Delivery time",
  OUT_OF_AREA: "Out of area",
  NO_RESPONSE: "No response",
  OTHER: "Other",
};

// A lost lead must carry a reason (§3.1).
export function lostReasonRequired(status: LeadStatusValue): boolean {
  return status === "LOST";
}

// "45m" / "6h" / "2d 4h" — the Committed queue's time-since-commitment (§9).
export function timeSince(iso: string, now: number = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
}

// One "interested in" selection — a product or package snapshot (§3.1). Names are
// frozen at pick time so the lead reads correctly even if the catalog changes.
export interface InterestedItem {
  itemType: "PRODUCT" | "PACKAGE";
  id: number;
  name: string;
}

// Serialized lead row shared by the API, list, report and dashboard widget.
export interface LeadRow {
  id: number;
  leadDate: string; // YYYY-MM-DD
  source: LeadSourceValue;
  campaignName: string | null;
  customerName: string | null;
  country: string | null;
  whatsappNumber: string;
  interestedIn: InterestedItem[];
  status: LeadStatusValue;
  committedAt: string | null; // ISO — when the lead last entered COMMITTED (§9)
  followUpAt: string | null; // ISO
  lostReason: LostReasonValue | null;
  notes: string | null;
  assignedToId: number;
  assignedToName: string;
  teamId: number | null;
  convertedOrder: { id: number; orderNo: string } | null;
  createdAt: string;
  updatedAt: string;
}
