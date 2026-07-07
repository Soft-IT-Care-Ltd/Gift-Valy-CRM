// Steadfast integration constants — STEADFAST_INTEGRATION.md §2 / §3.
// Client-safe: no Prisma/server imports (used by the mapper, the API client,
// the send flow and the UI alike).

import type { ShipmentStatusValue } from "./courier-constants";

export const STEADFAST_COURIER_NAME = "Steadfast";

// The target ShipmentStatus a Steadfast status maps to, or null when the status
// carries no order/shipment status change (in_review / partial / unknown).
export type SteadfastTargetStatus = Extract<
  ShipmentStatusValue,
  "IN_TRANSIT" | "DELIVERED" | "RETURNED"
> | null;

export interface MappedSteadfastStatus {
  raw: string; // exactly what Steadfast sent
  normalized: string; // lowercased/trimmed for matching
  to: SteadfastTargetStatus; // shipment/order status to move to (null = no move)
  onHold: boolean; // set shipment.on_hold (§3B hold → ⚠ in courier report)
  needsAttention: boolean; // set shipment.needs_attention (unknown/partial/unrecognized)
  recognized: boolean; // false = status not in the documented set (still logged)
}

// §3B mapping table — case-INSENSITIVE (doc lists lowercase; webhook example
// sends "Delivered"). Accepts BOTH the shorter webhook set and the fuller V1
// polling set (in_review, hold, *_approval_pending) per the note in §3.
//
// PARTIAL and "unknown" have no Gift Valy order/shipment status, so they never
// transition — they only raise needs_attention for manual review (§3B), keeping
// the order lifecycle enum untouched.
export function mapSteadfastStatus(raw: string): MappedSteadfastStatus {
  const normalized = (raw ?? "").trim().toLowerCase();
  const base: Omit<MappedSteadfastStatus, "to" | "onHold" | "needsAttention" | "recognized"> = {
    raw,
    normalized,
  };
  switch (normalized) {
    case "in_review":
      return { ...base, to: null, onHold: false, needsAttention: false, recognized: true };
    case "pending":
      return { ...base, to: "IN_TRANSIT", onHold: false, needsAttention: false, recognized: true };
    case "hold":
      return { ...base, to: "IN_TRANSIT", onHold: true, needsAttention: false, recognized: true };
    case "delivered":
    case "delivered_approval_pending":
      return { ...base, to: "DELIVERED", onHold: false, needsAttention: false, recognized: true };
    case "partial_delivered":
    case "partial_delivered_approval_pending":
      // No PARTIAL status in the lifecycle — flag for Accounts manual review.
      return { ...base, to: null, onHold: false, needsAttention: true, recognized: true };
    case "cancelled":
    case "cancelled_approval_pending":
      return { ...base, to: "RETURNED", onHold: false, needsAttention: false, recognized: true };
    case "unknown":
    case "unknown_approval_pending":
      return { ...base, to: null, onHold: false, needsAttention: true, recognized: true };
    default:
      // Anything undocumented is never acted on, but is logged and flagged.
      return { ...base, to: null, onHold: false, needsAttention: true, recognized: false };
  }
}

// A Steadfast status is "final" once the shipment can no longer change — stop
// polling it (§3B). delivered / cancelled(→returned) / partial are terminal.
export function isFinalSteadfastStatus(normalized: string): boolean {
  const n = normalized.trim().toLowerCase();
  return (
    n === "delivered" ||
    n === "delivered_approval_pending" ||
    n === "cancelled" ||
    n === "cancelled_approval_pending" ||
    n === "partial_delivered" ||
    n === "partial_delivered_approval_pending"
  );
}

// Normalize a phone to an 11-digit Bangladesh number 01XXXXXXXXX (§2 mapping
// rule): strip a leading 00 / 88 country prefix and all non-digits. Returns null
// when it is not a valid BD mobile number — the caller blocks the send (§2, and
// acceptance test #4: 10-digit phone → blocked).
export function normalizeBdPhone(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("88")) d = d.slice(2);
  return /^01\d{9}$/.test(d) ? d : null;
}
