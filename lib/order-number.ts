import type { Prisma } from "@prisma/client";

// "2610" — the Dhaka year+month an order number belongs to.
export function dhakaYearMonth(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "2-digit",
    month: "2-digit",
  }).formatToParts(date);
  const yy = parts.find((p) => p.type === "year")!.value;
  const mm = parts.find((p) => p.type === "month")!.value;
  return `${yy}${mm}`;
}

// FUNNEL_LINER.md GV-1 / CLAUDE.md rule 6 — THE only way an order gets its
// GV- number, and the only writer of order_sequences (the billing record).
// One atomic statement: insert the month's row at 1 or count it up, inside
// the caller's transaction — so concurrent creates never share a number and a
// rolled-back transaction gives its number back (no gaps). Takes a
// TransactionClient on purpose: the root client can't be passed. `at` exists
// only for the demo seed's backdated orders; app code never passes it.
export async function generateOrderNumber(
  tx: Prisma.TransactionClient,
  at: Date = new Date()
): Promise<string> {
  const yearMonth = dhakaYearMonth(at);
  const [row] = await tx.$queryRaw<{ last_number: number }[]>`
    INSERT INTO "order_sequences" ("year_month", "last_number", "updated_at")
    VALUES (${yearMonth}, 1, now())
    ON CONFLICT ("year_month") DO UPDATE
      SET "last_number" = "order_sequences"."last_number" + 1, "updated_at" = now()
    RETURNING "last_number"`;
  return formatOrderNo(yearMonth, row.last_number);
}

// The counter value n of month yearMonth as its order number. Also used
// read-only by the usage endpoint (GV-2) to show the month's last number —
// formatting is not numbering; only generateOrderNumber hands numbers out.
// At least 4 digits; 10,000+ grows to 5 — never wraps.
export function formatOrderNo(yearMonth: string, n: number): string {
  return `GV-${yearMonth}-${String(n).padStart(4, "0")}`;
}
