// Order Management constants — SPEC §1.3 / §4 / §8.
// Client-safe: no Prisma/server imports (used by forms and API routes alike).

export const ORDER_STATUSES = [
  "DRAFT",
  "LEAD",
  "FOLLOW_UP",
  "CONFIRMED",
  "PACKED",
  "HANDED_TO_COURIER",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
  "ON_HOLD",
  "CANCELLED",
  "RETURNED",
  "REFUNDED",
] as const;

export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatusValue, string> = {
  DRAFT: "Draft",
  LEAD: "Lead",
  FOLLOW_UP: "Follow-up",
  CONFIRMED: "Confirmed",
  PACKED: "Packed",
  HANDED_TO_COURIER: "Handed to courier",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  ON_HOLD: "On hold",
  CANCELLED: "Cancelled",
  RETURNED: "Returned",
  REFUNDED: "Refunded",
};

// SPEC §1.3 lifecycle. Orders are entered at CONFIRMED (§4.1 E) — or ON_HOLD
// when there is no advance yet (rule: no CONFIRMED without advance > 0), or
// DRAFT when a committed-but-unpaid order is saved ahead of the advance
// (CORRECTIONS Leads §10). COMPLETED additionally requires due_amount = 0
// (checked server-side). DRAFT → CONFIRMED assigns the real GV number.
export const ALLOWED_TRANSITIONS: Record<OrderStatusValue, OrderStatusValue[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  LEAD: ["FOLLOW_UP", "CONFIRMED", "CANCELLED"],
  FOLLOW_UP: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PACKED", "ON_HOLD", "CANCELLED"],
  PACKED: ["HANDED_TO_COURIER", "ON_HOLD", "CANCELLED"],
  HANDED_TO_COURIER: ["IN_TRANSIT", "DELIVERED", "RETURNED"],
  IN_TRANSIT: ["DELIVERED", "RETURNED"],
  DELIVERED: ["COMPLETED", "RETURNED"],
  COMPLETED: [],
  ON_HOLD: ["CONFIRMED", "CANCELLED"],
  CANCELLED: ["REFUNDED"],
  RETURNED: ["REFUNDED"],
  REFUNDED: [],
};

// Edits only make sense before courier handover; later corrections go through
// cancel/return flows. DRAFT is editable — details may change while the SE
// chases the advance (CORRECTIONS Leads §10).
export const EDITABLE_STATUSES: OrderStatusValue[] = [
  "DRAFT",
  "CONFIRMED",
  "ON_HOLD",
  "PACKED",
];

// SPEC §5 — invoices exist only once an order has reached CONFIRMED;
// pre-sale stages (incl. DRAFT) and never-confirmed holds/cancels have
// nothing to invoice.
export const NON_INVOICEABLE_STATUSES: OrderStatusValue[] = [
  "DRAFT",
  "LEAD",
  "FOLLOW_UP",
  "ON_HOLD",
  "CANCELLED",
];

export function orderIsInvoiceable(status: OrderStatusValue): boolean {
  return !NON_INVOICEABLE_STATUSES.includes(status);
}

// §4.2 — an order counts toward sales (SE dashboard, targets, leaderboard) unless
// its money came back or never landed: cancelled, returned and refunded orders
// are excluded. Shared so the home dashboard and the Targets gauges agree.
export const NON_SALE_STATUSES: OrderStatusValue[] = [
  "CANCELLED",
  "RETURNED",
  "REFUNDED",
];

// CORRECTIONS Leads §10 — DRAFT orders are not sales YET (committed-but-unpaid
// pipeline): excluded from every sales/collection metric, but never counted as
// "lost" the way the NON_SALE trio is. Sales filters use the combined list.
export const PRE_SALE_STATUSES: OrderStatusValue[] = ["DRAFT"];

export const EXCLUDED_SALE_STATUSES: OrderStatusValue[] = [
  ...NON_SALE_STATUSES,
  ...PRE_SALE_STATUSES,
];

export const PAYMENT_TYPES = [
  "ADVANCE",
  "PARTIAL",
  "COD_COURIER",
  "POST_DELIVERY_MFS",
  "REFUND",
] as const;

export type PaymentTypeValue = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_TYPE_LABELS: Record<PaymentTypeValue, string> = {
  ADVANCE: "Advance",
  PARTIAL: "Partial",
  COD_COURIER: "COD (courier)",
  POST_DELIVERY_MFS: "Post-delivery MFS",
  REFUND: "Refund (−)",
};

export const PAYMENT_METHODS = [
  "BKASH",
  "NAGAD",
  "ROCKET",
  "BANK",
  "CASH",
  "COURIER_COD",
  "OTHER",
] as const;

export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodValue, string> = {
  BKASH: "bKash",
  NAGAD: "Nagad",
  ROCKET: "Rocket",
  BANK: "Bank",
  CASH: "Cash",
  COURIER_COD: "Courier COD",
  OTHER: "Other",
};

// Transaction ID is mandatory for mobile-financial-service methods (§4.1 D / §8).
export const MFS_METHODS: PaymentMethodValue[] = ["BKASH", "NAGAD", "ROCKET"];

// CORRECTIONS Products §3 — the recipient's delivery zone. Order-form selector;
// item zone charges auto-fill the order's delivery charge from the match.
export const DELIVERY_ZONES = [
  "INSIDE_DHAKA",
  "SUB_DHAKA",
  "OUTSIDE_DHAKA",
] as const;

export type DeliveryZoneValue = (typeof DELIVERY_ZONES)[number];

export const DELIVERY_ZONE_LABELS: Record<DeliveryZoneValue, string> = {
  INSIDE_DHAKA: "Inside Dhaka",
  SUB_DHAKA: "Sub Dhaka",
  OUTSIDE_DHAKA: "Outside Dhaka",
};

// CORRECTIONS Orders §4 — "Special One ❤" discreetly covers girlfriend/
// boyfriend in one option (either direction).
export const RECIPIENT_RELATIONS = [
  "Wife",
  "Husband",
  "Special One ❤",
  "Mother",
  "Father",
  "Sibling",
  "Son",
  "Daughter",
  "Friend",
  "Relative",
  "Other",
] as const;

// CORRECTIONS Orders §1 — requested-delivery timing modes.
export const DELIVERY_DATE_MODES = ["ASAP", "ANY_DAY", "FIXED"] as const;

export type DeliveryDateModeValue = (typeof DELIVERY_DATE_MODES)[number];

export const DELIVERY_DATE_MODE_LABELS: Record<DeliveryDateModeValue, string> = {
  ASAP: "ASAP / Urgent",
  ANY_DAY: "Any day",
  FIXED: "Fixed date",
};

// Join address parts, skipping empties — District/Thana are "" on new orders
// (CORRECTIONS Orders §5) but still present on legacy rows.
export function joinAddress(
  ...parts: (string | null | undefined)[]
): string {
  return parts.map((p) => p?.trim()).filter(Boolean).join(", ");
}

export const OCCASIONS = [
  "Birthday",
  "Anniversary",
  "Wedding",
  "Eid",
  "Valentine's Day",
  "Mother's Day",
  "Father's Day",
  "New Baby",
  "Graduation",
  "Get Well Soon",
  "Just Because",
  "Other",
] as const;

// SPEC §3.1 country list (editable list is a later admin feature).
export const CUSTOMER_COUNTRIES = [
  "KSA",
  "UAE",
  "Qatar",
  "Kuwait",
  "Oman",
  "Bahrain",
  "Malaysia",
  "Singapore",
  "Maldives",
  "Italy",
  "UK",
  "USA",
  "Canada",
  "Australia",
  "Germany",
  "France",
  "South Korea",
  "Japan",
  "Other",
] as const;

// All 64 districts of Bangladesh — drives courier zone & charge (§4.1 B).
// Thana stays free-text in Phase 1; courier zone charges are per-district (§14).
export const BD_DISTRICTS = [
  "Bagerhat", "Bandarban", "Barguna", "Barishal", "Bhola", "Bogura",
  "Brahmanbaria", "Chandpur", "Chapainawabganj", "Chattogram", "Chuadanga",
  "Cox's Bazar", "Cumilla", "Dhaka", "Dinajpur", "Faridpur", "Feni",
  "Gaibandha", "Gazipur", "Gopalganj", "Habiganj", "Jamalpur", "Jashore",
  "Jhalokathi", "Jhenaidah", "Joypurhat", "Khagrachhari", "Khulna",
  "Kishoreganj", "Kurigram", "Kushtia", "Lakshmipur", "Lalmonirhat",
  "Madaripur", "Magura", "Manikganj", "Meherpur", "Moulvibazar", "Munshiganj",
  "Mymensingh", "Naogaon", "Narail", "Narayanganj", "Narsingdi", "Natore",
  "Netrokona", "Nilphamari", "Noakhali", "Pabna", "Panchagarh", "Patuakhali",
  "Pirojpur", "Rajbari", "Rajshahi", "Rangamati", "Rangpur", "Satkhira",
  "Shariatpur", "Sherpur", "Sirajganj", "Sunamganj", "Sylhet", "Tangail",
  "Thakurgaon",
] as const;

// Normalize phones for lookup/dedup: keep a leading + and digits only,
// so "+966 55-123 4567" and "+96655 1234567" match (§4.1 A auto-fill).
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

// A `@db.Date` column stores a bare calendar day; Prisma truncates any Date
// written or compared against it to the instant's UTC calendar date. A Dhaka
// +06:00 instant (e.g. the 1st at 00:00+06 = the prior day 18:00 UTC) therefore
// resolves to the PREVIOUS day — leaking the day before into `gte` ranges and
// storing user-picked days one day early. Both helpers pin a value to
// UTC-midnight of its Dhaka calendar day so `@db.Date` round-trips exactly.

// Range bound (or derived write) from an existing Date/instant.
export function dhakaDateBound(d: Date): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return new Date(`${ymd}T00:00:00.000Z`);
}

// Write value for a user-picked "YYYY-MM-DD" string.
export function dbDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}
