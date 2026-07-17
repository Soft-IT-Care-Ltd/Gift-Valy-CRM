// Steadfast integration constants — STEADFAST_INTEGRATION.md §2 / §3.
// Client-safe: no Prisma/server imports (used by the mapper, the API client,
// the send flow and the UI alike).

import type {
  CourierStatusValue,
  ShipmentStatusValue,
} from "./courier-constants";

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
  // CORRECTIONS Orders §6m — the In Transit sub-state this status implies
  // (null = leave the shipment's current sub-state untouched).
  courierStatus: CourierStatusValue | null;
  onHold: boolean; // set shipment.on_hold (§3B hold → ⚠ in courier report)
  needsAttention: boolean; // set shipment.needs_attention (unknown/partial/unrecognized)
  recognized: boolean; // false = status not in the documented set (still logged)
}

// §3B mapping table — case-INSENSITIVE (doc lists lowercase; webhook example
// sends "Delivered"). Accepts BOTH the shorter webhook set and the fuller V1
// polling set (in_review, hold, *_approval_pending) per the note in §3.
//
// CORRECTIONS Orders §6m — the *_approval_pending statuses do NOT move the
// order any more: the rider has delivered/returned the parcel but the hub
// manager hasn't approved (COD not yet in our balance), so the order stays
// IN_TRANSIT under the matching sub-tab. Only the FINAL approval statuses
// (delivered / cancelled) move the order to Delivered / Returned.
//
// PARTIAL and "unknown" have no Gift Valy order/shipment status, so they never
// transition — they only raise needs_attention for manual review (§3B), keeping
// the order lifecycle enum untouched.
export function mapSteadfastStatus(raw: string): MappedSteadfastStatus {
  const normalized = (raw ?? "").trim().toLowerCase();
  const base: Omit<
    MappedSteadfastStatus,
    "to" | "courierStatus" | "onHold" | "needsAttention" | "recognized"
  > = {
    raw,
    normalized,
  };
  switch (normalized) {
    case "in_review":
      return { ...base, to: null, courierStatus: null, onHold: false, needsAttention: false, recognized: true };
    case "pending":
      // Parcel received at the Steadfast warehouse — the §6m auto-entry moment.
      return { ...base, to: "IN_TRANSIT", courierStatus: "PENDING", onHold: false, needsAttention: false, recognized: true };
    case "hold":
      return { ...base, to: "IN_TRANSIT", courierStatus: "PENDING", onHold: true, needsAttention: false, recognized: true };
    case "delivered":
      return { ...base, to: "DELIVERED", courierStatus: null, onHold: false, needsAttention: false, recognized: true };
    case "delivered_approval_pending":
      return { ...base, to: "IN_TRANSIT", courierStatus: "DELIVERY_APPROVAL_PENDING", onHold: false, needsAttention: false, recognized: true };
    case "partial_delivered":
      // No PARTIAL status in the lifecycle — flag for Accounts manual review.
      return { ...base, to: null, courierStatus: null, onHold: false, needsAttention: true, recognized: true };
    case "partial_delivered_approval_pending":
      // Approval-wait for a partial delivery — surfaces under the delivery
      // approval sub-tab AND keeps the manual-review flag.
      return { ...base, to: "IN_TRANSIT", courierStatus: "DELIVERY_APPROVAL_PENDING", onHold: false, needsAttention: true, recognized: true };
    case "cancelled":
      return { ...base, to: "RETURNED", courierStatus: null, onHold: false, needsAttention: false, recognized: true };
    case "cancelled_approval_pending":
      return { ...base, to: "IN_TRANSIT", courierStatus: "RETURN_APPROVAL_PENDING", onHold: false, needsAttention: false, recognized: true };
    case "unknown":
    case "unknown_approval_pending":
      return { ...base, to: null, courierStatus: null, onHold: false, needsAttention: true, recognized: true };
    default:
      // Anything undocumented is never acted on, but is logged and flagged.
      return { ...base, to: null, courierStatus: null, onHold: false, needsAttention: true, recognized: false };
  }
}

// A Steadfast status is "final" once the shipment can no longer change — stop
// polling it (§3B). Since C6, *_approval_pending is NOT final: the shipment
// still awaits the hub manager, so polling continues until the true terminal
// status (delivered / cancelled / partial_delivered) lands.
export function isFinalSteadfastStatus(normalized: string): boolean {
  const n = normalized.trim().toLowerCase();
  return n === "delivered" || n === "cancelled" || n === "partial_delivered";
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

// ---------- public tracking link (CORRECTIONS Orders §6k/§6l) ----------

// Steadfast's public tracking page. Verified against steadfast.com.bd: the
// tracking form resolves both /t/{code} and /tl/{token} links (their frontend's
// resolveCode regex is /\/t(?:l)?\/([^/?&#\s]+)/) and the page itself calls
// GET /tl/{token} with Accept: application/json — so the constructed link works
// for tracking_code-based lookups and doubles as our server-side JSON source.
export const STEADFAST_TRACKING_BASE = "https://steadfast.com.bd/tl/";

export function trackingUrlFromCode(
  trackingCode: string | null | undefined
): string | null {
  const code = trackingCode?.trim();
  return code ? `${STEADFAST_TRACKING_BASE}${encodeURIComponent(code)}` : null;
}

// The documented create-order response carries only consignment_id +
// tracking_code, but §6l says: log the FULL raw response and, if a tracking
// link/token field ever shows up, prefer it. This scans any raw payload
// (objects/arrays, a few levels deep) for such a field — a full URL under a
// *track*-named key, any /t/… or /tl/… steadfast link in a string value, or a
// bare token under a key like public_tracking_token.
export function discoverTrackingUrl(raw: unknown): string | null {
  const seen = new Set<object>();
  function scan(node: unknown, depth: number): string | null {
    if (node == null || depth > 4) return null;
    if (typeof node === "string") {
      const m = node.match(
        /https?:\/\/(?:www\.)?steadfast\.com\.bd\/t(?:l)?\/[^\s"'<>]+/i
      );
      return m ? m[0] : null;
    }
    if (typeof node !== "object") return null;
    if (seen.has(node as object)) return null;
    seen.add(node as object);
    const entries = Array.isArray(node)
      ? node.map((v, i) => [String(i), v] as const)
      : Object.entries(node as Record<string, unknown>);
    // Pass 1: keys that look like a tracking link/token.
    for (const [key, value] of entries) {
      if (typeof value !== "string" || !value.trim()) continue;
      if (!/track/i.test(key)) continue;
      if (/link|url/i.test(key)) {
        const v = value.trim();
        return /^https?:\/\//i.test(v) ? v : `${STEADFAST_TRACKING_BASE}${v}`;
      }
      if (/token/i.test(key)) return `${STEADFAST_TRACKING_BASE}${value.trim()}`;
    }
    // Pass 2: any nested value containing a steadfast tracking URL.
    for (const [, value] of entries) {
      const found = scan(value, depth + 1);
      if (found) return found;
    }
    return null;
  }
  return scan(raw, 0);
}

// §6l — the documented payloads don't promise delivery_charge/weight outside the
// webhook, so every raw API response is also inspected for them. Finds the first
// numeric value under a matching key (a few levels deep), e.g. delivery_charge,
// weight, parcel_weight.
export function findNumericField(
  raw: unknown,
  keyPattern: RegExp
): number | null {
  const seen = new Set<object>();
  function scan(node: unknown, depth: number): number | null {
    if (node == null || typeof node !== "object" || depth > 4) return null;
    if (seen.has(node as object)) return null;
    seen.add(node as object);
    const entries = Array.isArray(node)
      ? node.map((v, i) => [String(i), v] as const)
      : Object.entries(node as Record<string, unknown>);
    for (const [key, value] of entries) {
      if (keyPattern.test(key)) {
        const n = Number(value);
        if (value !== null && value !== "" && Number.isFinite(n)) return n;
      }
    }
    for (const [, value] of entries) {
      const found = scan(value, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  return scan(raw, 0);
}

export const DELIVERY_CHARGE_KEY = /^(delivery_charge|deliveryCharge|charge)$/;
export const WEIGHT_KEY = /^(weight|parcel_weight|weight_kg)$/i;

// CORRECTIONS Orders §6m — rider name/contact are NOT in the documented API,
// but "if a webhook/API response turns out to carry rider info, prefer that":
// every raw payload is scanned for a rider-shaped object ({ rider: { name,
// phone } } — the shape the public tracking JSON uses) or flat rider_name /
// rider_phone-style keys, a few levels deep.
export interface RiderInfo {
  name: string;
  phone: string | null;
}

const RIDER_OBJECT_KEY = /^(rider|delivery_man|deliveryman|assigned_to)$/i;
const RIDER_NAME_KEY = /^(rider|delivery_man|deliveryman)_?name$/i;
const RIDER_PHONE_KEY = /^(rider|delivery_man|deliveryman)_?(phone|contact|mobile|number)$/i;

export function findRiderInfo(raw: unknown): RiderInfo | null {
  const seen = new Set<object>();
  function scan(node: unknown, depth: number): RiderInfo | null {
    if (node == null || typeof node !== "object" || depth > 4) return null;
    if (seen.has(node as object)) return null;
    seen.add(node as object);
    const entries = Array.isArray(node)
      ? node.map((v, i) => [String(i), v] as const)
      : Object.entries(node as Record<string, unknown>);
    // Pass 1: a nested rider object with name/phone fields.
    for (const [key, value] of entries) {
      if (!RIDER_OBJECT_KEY.test(key) || value == null || typeof value !== "object") continue;
      const o = value as Record<string, unknown>;
      const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : null;
      if (!name) continue;
      const phone =
        typeof o.phone === "string" && o.phone.trim()
          ? o.phone.trim()
          : typeof o.contact === "string" && o.contact.trim()
            ? o.contact.trim()
            : typeof o.mobile === "string" && o.mobile.trim()
              ? o.mobile.trim()
              : null;
      return { name, phone };
    }
    // Pass 2: flat rider_name / rider_phone keys on the same level.
    let name: string | null = null;
    let phone: string | null = null;
    for (const [key, value] of entries) {
      if (typeof value !== "string" || !value.trim()) continue;
      if (RIDER_NAME_KEY.test(key)) name = value.trim();
      else if (RIDER_PHONE_KEY.test(key)) phone = value.trim();
    }
    if (name) return { name, phone };
    // Pass 3: recurse.
    for (const [, value] of entries) {
      const found = scan(value, depth + 1);
      if (found) return found;
    }
    return null;
  }
  return scan(raw, 0);
}
