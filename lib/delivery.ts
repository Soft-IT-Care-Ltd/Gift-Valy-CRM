import { prisma } from "./db";
import { dbDate } from "./order-constants";
import { getCourierStuckThresholds } from "./settings";
import {
  dhakaToday,
  dhakaTomorrow,
  fmtWeekdayDate,
} from "./delivery-schedule";

// ============ CORRECTIONS Orders §2/§3 — Delivery Schedule + late-risk ============
//
// A date-wise view of the deliveries operations still has to make: orders that
// are CONFIRMED or PACKED (i.e. NOT yet handed to a courier — once handed over
// the courier owns the timing, tracked on the courier tabs). Grouped by requested
// delivery date, with ASAP always in Today and Any-day orders in a flexible group.
//
// Late-risk (§3): a FIXED-date order due today or tomorrow that is still not
// PACKED (status CONFIRMED) — the team must pack + hand it over now or it misses
// the promised date. Surfaced as a red flag here + a count on the dashboard.

// Pre-courier fulfilment stages — what the packing team still acts on.
const SCHEDULE_STATUSES = ["CONFIRMED", "PACKED"] as const;

export interface DeliveryRow {
  orderId: number;
  orderNo: string;
  recipientName: string;
  recipientPhone: string;
  deliveryAddress: string;
  customerName: string;
  status: "CONFIRMED" | "PACKED";
  deliveryDateMode: "ASAP" | "ANY_DAY" | "FIXED";
  requestedDeliveryDate: string | null; // YYYY-MM-DD
  items: { name: string; qty: number }[];
  salesExecutive: string;
  lateRisk: boolean;
}

export interface DeliveryGroup {
  // "overdue" | "today" | "tomorrow" | a YYYY-MM-DD | "flexible"
  key: string;
  label: string;
  date: string | null;
  isToday: boolean;
  lateRiskCount: number;
  rows: DeliveryRow[];
}

export interface DeliveryScheduleData {
  groups: DeliveryGroup[];
  total: number;
  lateRiskCount: number; // rows flagged late-risk within the returned set
}

// A row is late-risk when a FIXED date of today/tomorrow is still un-packed.
function isLateRisk(
  mode: string,
  date: string | null,
  status: string,
  tomorrow: string
): boolean {
  return (
    mode === "FIXED" &&
    date != null &&
    date <= tomorrow &&
    status === "CONFIRMED"
  );
}

// Build the grouped schedule for the [from, to] delivery-date window. FIXED
// orders are filtered to the window; ASAP + ANY_DAY carry no date, so they are
// always included (ASAP → Today, ANY_DAY → the flexible group) per §2.
export async function buildDeliverySchedule(args: {
  from: string;
  to: string;
}): Promise<DeliveryScheduleData> {
  const { from, to } = args;
  const today = dhakaToday();
  const tomorrow = dhakaTomorrow();

  const orders = await prisma.order.findMany({
    where: {
      status: { in: [...SCHEDULE_STATUSES] },
      OR: [
        {
          deliveryDateMode: "FIXED",
          requestedDeliveryDate: { gte: dbDate(from), lte: dbDate(to) },
        },
        { deliveryDateMode: "ASAP" },
        { deliveryDateMode: "ANY_DAY" },
      ],
    },
    include: {
      customer: { select: { name: true } },
      salesExecutive: { select: { name: true } },
      items: {
        select: {
          qty: true,
          customName: true,
          product: { select: { name: true } },
          package: { select: { name: true } },
        },
      },
    },
  });

  const rows: DeliveryRow[] = orders.map((o) => {
    const date = o.requestedDeliveryDate
      ? o.requestedDeliveryDate.toISOString().slice(0, 10)
      : null;
    return {
      orderId: o.id,
      orderNo: o.orderNo,
      recipientName: o.recipientName,
      recipientPhone: o.recipientPhoneBd,
      deliveryAddress: o.deliveryAddress,
      customerName: o.customer.name,
      status: o.status as "CONFIRMED" | "PACKED",
      deliveryDateMode: o.deliveryDateMode,
      requestedDeliveryDate: date,
      items: o.items.map((it) => ({
        name: it.product?.name ?? it.package?.name ?? it.customName ?? "(custom)",
        qty: it.qty,
      })),
      salesExecutive: o.salesExecutive.name,
      lateRisk: isLateRisk(o.deliveryDateMode, date, o.status, tomorrow),
    };
  });

  // ---- group ----
  const byKey = new Map<string, DeliveryRow[]>();
  const push = (key: string, row: DeliveryRow) => {
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  };

  for (const row of rows) {
    if (row.deliveryDateMode === "ASAP") {
      push("today", row); // ASAP always sits in Today (§2)
    } else if (row.deliveryDateMode === "ANY_DAY") {
      push("flexible", row);
    } else if (row.requestedDeliveryDate) {
      const d = row.requestedDeliveryDate;
      if (d < today) push("overdue", row);
      else push(d, row);
    }
  }

  // Order rows inside a group: late-risk first, then ASAP urgency, then oldest.
  const sortRows = (a: DeliveryRow[]) =>
    a
      .slice()
      .sort(
        (x, y) =>
          Number(y.lateRisk) - Number(x.lateRisk) ||
          (x.deliveryDateMode === "ASAP" ? 0 : 1) -
            (y.deliveryDateMode === "ASAP" ? 0 : 1) ||
          x.orderNo.localeCompare(y.orderNo)
      );

  const makeGroup = (
    key: string,
    label: string,
    date: string | null
  ): DeliveryGroup | null => {
    const list = byKey.get(key);
    if (!list || list.length === 0) return null;
    const sorted = sortRows(list);
    return {
      key,
      label,
      date,
      isToday: key === "today",
      lateRiskCount: sorted.filter((r) => r.lateRisk).length,
      rows: sorted,
    };
  };

  const groups: DeliveryGroup[] = [];
  const overdue = makeGroup("overdue", "Overdue", null);
  if (overdue) groups.push(overdue);
  const todayGroup = makeGroup("today", "Today", today);
  if (todayGroup) groups.push(todayGroup);
  const tomorrowGroup = makeGroup(tomorrow, "Tomorrow", tomorrow);
  if (tomorrowGroup) groups.push(tomorrowGroup);

  // Remaining dated groups (exclude today/tomorrow already placed), ascending.
  const datedKeys = [...byKey.keys()]
    .filter(
      (k) =>
        k !== "overdue" &&
        k !== "today" &&
        k !== "flexible" &&
        k !== tomorrow
    )
    .sort();
  for (const key of datedKeys) {
    const g = makeGroup(key, fmtWeekdayDate(key), key);
    if (g) groups.push(g);
  }

  const flexible = makeGroup("flexible", "Flexible — Any day", null);
  if (flexible) groups.push(flexible);

  const total = rows.length;
  const lateRiskCount = rows.filter((r) => r.lateRisk).length;
  return { groups, total, lateRiskCount };
}

// CORRECTIONS Orders §3 — the dashboard "fixed-date deliveries at risk" count:
// FIXED-date orders due today or tomorrow still stuck at CONFIRMED (un-packed).
// Trashed orders are auto-excluded by the lib/db.ts order filter.
export async function countLateRiskDeliveries(): Promise<number> {
  const tomorrow = dhakaTomorrow();
  return prisma.order.count({
    where: {
      status: "CONFIRMED",
      deliveryDateMode: "FIXED",
      requestedDeliveryDate: { lte: dbDate(tomorrow) },
    },
  });
}

// CORRECTIONS Orders §R6 — the "stuck parcels" count: In Transit shipments that
// have sat in their current courier sub-status at least the amber threshold. Also
// returns the threshold so the dashboard can deep-link the matching stuck filter.
export async function countStuckParcels(): Promise<{
  count: number;
  thresholdDays: number;
}> {
  const { amberDays } = await getCourierStuckThresholds();
  const count = await prisma.shipment.count({
    where: {
      courierStatusAt: { lte: new Date(Date.now() - amberDays * 86_400_000) },
      // Shipment model is not trash-auto-filtered — exclude trashed orders here.
      order: { is: { status: "IN_TRANSIT", deletedAt: null } },
    },
  });
  return { count, thresholdDays: amberDays };
}
