// Company wallets/accounts — SPEC §8 / §14. Client-safe constants live here so
// forms and API routes share one source of truth (no Prisma import at the top).
import type { Prisma } from "@prisma/client";

export const WALLET_TYPES = ["BKASH", "NAGAD", "ROCKET", "BANK", "CASH"] as const;

export type WalletTypeValue = (typeof WALLET_TYPES)[number];

export const WALLET_TYPE_LABELS: Record<WalletTypeValue, string> = {
  BKASH: "bKash",
  NAGAD: "Nagad",
  ROCKET: "Rocket",
  BANK: "Bank",
  CASH: "Cash",
};

// A wallet with its usage counts — drives the "deactivate instead of delete"
// guard (a wallet with payments/expenses on record is never hard-deleted).
export type WalletWithCounts = Prisma.WalletGetPayload<{
  include: { _count: { select: { payments: true; expenses: true } } };
}>;

export function serializeWallet(w: WalletWithCounts) {
  return {
    id: w.id,
    name: w.name,
    type: w.type,
    accountNo: w.accountNo,
    isActive: w.isActive,
    paymentCount: w._count.payments,
    expenseCount: w._count.expenses,
  };
}

export type WalletRow = ReturnType<typeof serializeWallet>;

// The minimal shape a payment/advance form needs to pick a receiving wallet.
export interface WalletOption {
  id: number;
  name: string;
  type: WalletTypeValue;
}
