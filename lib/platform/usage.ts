import { dhakaYearMonth, formatOrderNo } from "@/lib/order-number";
import { readPlatformState } from "./state";
import type { PlatformState } from "./state-shape";
import type { Db } from "./tx";

// FUNNEL_LINER.md GV-2 — the billed number per Dhaka month. CLAUDE.md rule 6:
// it is order_sequences.lastNumber, the counter behind GV-YYMM-NNNN — never
// COUNT(*) on orders, which the nightly trash purge makes shrink. Counts and
// order numbers only: no customer, recipient, product, money or staff name
// ever leaves through here.

export type MonthUsage = {
  yearMonth: string;
  /** The billed number. */
  ordersCreated: number;
  /** e.g. GV-2610-0347 — the evidence a person can check; null when the month has none. */
  lastOrderNo: string | null;
  /** Information only, from rows that still exist. Never billed on; may add up to less than ordersCreated after a purge. */
  breakdown: {
    confirmedAndLater: number;
    onHold: number;
    cancelled: number;
    inTrash: number;
    /** DRAFT-XXXX rows created this Dhaka month and not confirmed yet — not counted in ordersCreated. */
    draftsNotConfirmed: number;
  };
};

export type UsageReport = {
  serverTime: string;
  version: string;
  /**
   * The state, when it changed and which push it came from — never the
   * message or amount. An object, as Antu's usage route answers: the admin
   * panel's usage parser (and its Test connection) refuses a bare string.
   */
  state: Pick<PlatformState, "state" | "changedAt" | "sentAt">;
  months: MonthUsage[];
};

const YYMM = /^\d{2}(0[1-9]|1[0-2])$/;
export const isYearMonth = (v: string) => YYMM.test(v);

export function nextYearMonth(ym: string): string {
  const y = Number(ym.slice(0, 2));
  const m = Number(ym.slice(2, 4));
  return m === 12
    ? `${String(y + 1).padStart(2, "0")}01`
    : `${ym.slice(0, 2)}${String(m + 1).padStart(2, "0")}`;
}

export function previousYearMonth(ym: string): string {
  const y = Number(ym.slice(0, 2));
  const m = Number(ym.slice(2, 4));
  return m === 1
    ? `${String(y - 1).padStart(2, "0")}12`
    : `${ym.slice(0, 2)}${String(m - 1).padStart(2, "0")}`;
}

/** Every YYMM from `from` to `to`, both included (empty when from > to). */
export function yearMonthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let ym = from; ym <= to && out.length < 1200; ym = nextYearMonth(ym)) out.push(ym);
  return out;
}

/** What is left out defaults to the previous and the current Dhaka month. */
export function usageRange(
  q: { from?: string; to?: string },
  now = new Date()
): { from: string; to: string } {
  const to = q.to ?? dhakaYearMonth(now);
  return { from: q.from ?? previousYearMonth(to), to };
}

export const MAX_USAGE_MONTHS = 36;

export async function monthlyUsage(db: Db, months: string[]): Promise<MonthUsage[]> {
  if (months.length === 0) return [];
  const sequences = await db.orderSequence.findMany({ where: { yearMonth: { in: months } } });
  const last = new Map(sequences.map((s) => [s.yearMonth, s.lastNumber]));
  // Raw SQL on purpose: it bypasses the trash auto-filter (lib/db.ts), so
  // trashed rows are counted. A GV order's month comes from its number — the
  // month the counter counted it in; a draft's from its Dhaka creation day.
  const rows = await db.$queryRaw<
    { ym: string; confirmed: bigint; on_hold: bigint; cancelled: bigint; in_trash: bigint; drafts: bigint }[]
  >`
    SELECT ym,
           count(*) FILTER (WHERE kind = 'GV' AND deleted_at IS NULL AND status NOT IN ('ON_HOLD', 'CANCELLED')) AS confirmed,
           count(*) FILTER (WHERE kind = 'GV' AND deleted_at IS NULL AND status = 'ON_HOLD') AS on_hold,
           count(*) FILTER (WHERE kind = 'GV' AND deleted_at IS NULL AND status = 'CANCELLED') AS cancelled,
           count(*) FILTER (WHERE kind = 'GV' AND deleted_at IS NOT NULL) AS in_trash,
           count(*) FILTER (WHERE kind = 'DRAFT' AND deleted_at IS NULL) AS drafts
      FROM (
        SELECT CASE WHEN order_no LIKE 'GV-____-%' THEN 'GV' ELSE 'DRAFT' END AS kind,
               CASE WHEN order_no LIKE 'GV-____-%' THEN substr(order_no, 4, 4)
                    ELSE to_char((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Dhaka', 'YYMM') END AS ym,
               status::text AS status, deleted_at
          FROM orders
         WHERE order_no LIKE 'GV-____-%' OR order_no LIKE 'DRAFT-%'
      ) o
     WHERE ym = ANY(${months})
     GROUP BY ym`;
  const byMonth = new Map(rows.map((r) => [r.ym, r]));
  return months.map((yearMonth) => {
    const n = last.get(yearMonth) ?? 0;
    const r = byMonth.get(yearMonth);
    return {
      yearMonth,
      ordersCreated: n,
      lastOrderNo: n > 0 ? formatOrderNo(yearMonth, n) : null,
      breakdown: {
        confirmedAndLater: Number(r?.confirmed ?? 0),
        onHold: Number(r?.on_hold ?? 0),
        cancelled: Number(r?.cancelled ?? 0),
        inTrash: Number(r?.in_trash ?? 0),
        draftsNotConfirmed: Number(r?.drafts ?? 0),
      },
    };
  });
}

/** "0.1.0+abc1234" — next.config.ts sets APP_VERSION / APP_COMMIT at build time. */
export function appVersion(): string {
  const version = process.env.APP_VERSION || "0.0.0";
  const commit = process.env.APP_COMMIT?.trim();
  return commit ? `${version}+${commit}` : version;
}

export async function usageReport(
  db: Db,
  range: { from: string; to: string },
  now = new Date()
): Promise<UsageReport> {
  const [months, state] = await Promise.all([
    monthlyUsage(db, yearMonthsBetween(range.from, range.to)),
    readPlatformState(db),
  ]);
  return {
    serverTime: now.toISOString(),
    version: appVersion(),
    state: { state: state.state, changedAt: state.changedAt, sentAt: state.sentAt },
    months,
  };
}
