// Courier & delivery constants — SPEC §7. Client-safe: no Prisma/server imports
// (used by the courier UI and by lib/courier.ts alike).

import type { OrderStatusValue } from "./order-constants";

export const SHIPMENT_STATUSES = [
  "HANDED_TO_COURIER",
  "IN_TRANSIT",
  "DELIVERED",
  "RETURNED",
] as const;

export type ShipmentStatusValue = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatusValue, string> = {
  HANDED_TO_COURIER: "Handed to courier",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered",
  RETURNED: "Returned",
};

// The order-lifecycle stages the Courier module owns (SPEC §7). The order detail
// page hides these from its generic status buttons so courier moves only ever
// happen through a shipment (single source of truth). Values are a subset of
// OrderStatus, so they map 1:1 to ShipmentStatus.
export const COURIER_STAGE_STATUSES: OrderStatusValue[] = [
  "HANDED_TO_COURIER",
  "IN_TRANSIT",
  "DELIVERED",
  "RETURNED",
];

// Allowed next shipment statuses — a subset of ALLOWED_TRANSITIONS restricted to
// courier stages (lib/order-constants.ts). The order lifecycle re-validates the
// matching order transition, so this only shapes which buttons the UI offers.
export const SHIPMENT_NEXT_STATUSES: Record<
  ShipmentStatusValue,
  ShipmentStatusValue[]
> = {
  HANDED_TO_COURIER: ["IN_TRANSIT", "DELIVERED", "RETURNED"],
  IN_TRANSIT: ["DELIVERED", "RETURNED"],
  DELIVERED: ["RETURNED"],
  RETURNED: [],
};

// CORRECTIONS Orders §6m — the In Transit courier sub-states (the shipment's
// journey INSIDE Steadfast while the order status stays IN_TRANSIT). Drives the
// 4 sub-tabs + the Courier Status column. A shipment with no sub-state yet
// (manual entry, pre-C6 rows) renders as PENDING.
export const COURIER_STATUSES = [
  "PENDING",
  "ASSIGNED",
  "DELIVERY_APPROVAL_PENDING",
  "RETURN_APPROVAL_PENDING",
] as const;

export type CourierStatusValue = (typeof COURIER_STATUSES)[number];

export const COURIER_STATUS_LABELS: Record<CourierStatusValue, string> = {
  PENDING: "Pending",
  ASSIGNED: "Assigned",
  DELIVERY_APPROVAL_PENDING: "Delivery Approval Pending",
  RETURN_APPROVAL_PENDING: "Return Approval Pending",
};

// CORRECTIONS Orders §6n — the Returned tab's sub-tabs: Pending = the parcel is
// on its way back (no stock change yet); Received = the Packaging team took it
// in and ran the damage inspection (OK → stock, Damaged → damage log).
export const RETURN_SUB_TABS = ["pending", "received"] as const;

export type ReturnSubTabValue = (typeof RETURN_SUB_TABS)[number];

// Auto-created expense category for courier fees — the COD remittance fee and
// the return courier charge both post here (SPEC §7 / §9.1, "Courier Charge").
export const COURIER_EXPENSE_CATEGORY = "Courier Charge";

// CORRECTIONS Orders §6n — damaged returns post their at-cost loss here so the
// monthly P&L counts it as a variable operating cost automatically.
export const DAMAGED_STOCK_EXPENSE_CATEGORY = "Damaged Stock";

// CORRECTIONS Courier §1 — one zone's rate row (base + per-kg) of the 3-zone
// table. Shared by the config UI, the estimate API and applyHandover.
export interface ZoneRate {
  zone: "INSIDE_DHAKA" | "SUB_DHAKA" | "OUTSIDE_DHAKA";
  baseRate: number;
  perKgRate: number;
}

// The courier cost ESTIMATE: base + per-kg × weight, rounded to paisa. Null when
// the zone has no configured rate (nothing to estimate from) — a missing weight
// just means the base rate. The webhook's actual delivery_charge later overrides
// this as courier_cost_actual; P&L prefers actual.
export function estimateCourierCost(
  rate: { baseRate: number; perKgRate: number } | null | undefined,
  weightKg: number | null | undefined
): number | null {
  if (!rate) return null;
  const cost = rate.baseRate + rate.perKgRate * Math.max(weightKg ?? 0, 0);
  return Math.round(cost * 100) / 100;
}

// Seed/reference list of couriers Gift Valy uses (SPEC §7). Free to edit in the UI.
export const COURIER_PRESETS = [
  "Steadfast",
  "Pathao",
  "RedX",
  "Sundarban",
  "Paperfly",
] as const;
