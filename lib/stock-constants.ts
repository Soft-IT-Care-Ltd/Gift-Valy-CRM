// Stock constants — SPEC §6.3. Client-safe: no Prisma/server imports
// (used by the stock UI and by lib/stock.ts alike).

export const STOCK_MOVEMENT_TYPES = [
  "IN_PURCHASE",
  "OUT_SALE",
  "RESERVE",
  "RELEASE_RESERVE",
  "IN_RETURN",
  "ADJUST_PLUS",
  "ADJUST_MINUS",
] as const;

export type StockMovementTypeValue = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_LABELS: Record<StockMovementTypeValue, string> = {
  IN_PURCHASE: "Purchase in",
  OUT_SALE: "Sale out",
  RESERVE: "Reserved",
  RELEASE_RESERVE: "Reservation released",
  IN_RETURN: "Return in",
  ADJUST_PLUS: "Adjustment +",
  ADJUST_MINUS: "Adjustment −",
};

export const PURCHASE_PAYMENT_STATUSES = ["PAID", "DUE", "PARTIAL"] as const;

export type PurchasePaymentStatusValue =
  (typeof PURCHASE_PAYMENT_STATUSES)[number];

export const PURCHASE_PAYMENT_STATUS_LABELS: Record<
  PurchasePaymentStatusValue,
  string
> = {
  PAID: "Paid",
  DUE: "Due",
  PARTIAL: "Partially paid",
};
