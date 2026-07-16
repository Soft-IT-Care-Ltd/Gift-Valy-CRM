// SPEC §5 — the WhatsApp invoice message. Pure (client + server safe): the
// order page uses it for the wa.me pre-filled text, and the Cloud API send
// uses it as the PDF caption, so the customer reads the same message either way.

import { money } from "./format";
import {
  formatInCurrency,
  rateLine,
  type CurrencyDisplay,
} from "./currency-constants";

export interface InvoiceMessageOrder {
  orderNo: string;
  customerName: string;
  totalAmount: number;
  advanceAmount: number;
  dueAmount: number;
  recipientName: string;
  district: string;
}

export function buildInvoiceMessage(
  o: InvoiceMessageOrder,
  currency?: CurrencyDisplay | null
): string {
  // "৳3,500 (≈ SAR 107.69)" when the customer's country has a rate (§5).
  const amt = (n: number) =>
    currency ? `${money(n)} (≈ ${formatInCurrency(n, currency)})` : money(n);
  const lines = [
    `আসসালামু আলাইকুম ${o.customerName}!`,
    `Gift Valy-তে অর্ডার করার জন্য আপনাকে ধন্যবাদ। আপনার ইনভয়েস:`,
    ``,
    `🧾 Invoice: ${o.orderNo}`,
    `মোট: ${amt(o.totalAmount)}`,
    `অগ্রিম জমা: ${amt(o.advanceAmount)}`,
    `বাকি (ডেলিভারিতে): ${amt(o.dueAmount)}`,
    // District is "" on new orders (CORRECTIONS Orders §5) — only append when set.
    `প্রাপক: ${o.recipientName}${o.district?.trim() ? `, ${o.district}` : ""}`,
  ];
  if (currency) {
    lines.push(`(${rateLine(currency)} — ${currency.code} amounts আনুমানিক)`);
  }
  lines.push(
    ``,
    `ইনভয়েস PDF টি এই চ্যাটে পাঠানো হচ্ছে। যেকোনো প্রয়োজনে মেসেজ করুন। — Gift Valy`
  );
  return lines.join("\n");
}
