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

// Auto-created expense category for courier fees — the COD remittance fee and
// the return courier charge both post here (SPEC §7 / §9.1, "Courier Charge").
export const COURIER_EXPENSE_CATEGORY = "Courier Charge";

// Seed/reference list of couriers Gift Valy uses (SPEC §7). Free to edit in the UI.
export const COURIER_PRESETS = [
  "Steadfast",
  "Pathao",
  "RedX",
  "Sundarban",
  "Paperfly",
] as const;
