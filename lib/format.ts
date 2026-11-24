// BDT display helper — safe for client and server components.
export const money = (n: number) => `৳${n.toLocaleString("en-IN")}`;
// ROUND3 R3-2 — a choice option's extra price: "+৳300", "−৳200", "+৳0".
export const signedMoney = (n: number) =>
  `${n < 0 ? "−" : "+"}৳${Math.abs(n).toLocaleString("en-IN")}`;

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
