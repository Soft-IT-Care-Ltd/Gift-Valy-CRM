import type { Prisma, PrismaClient, StockMovementType } from "@prisma/client";
import { AuthzError } from "./authz";

type Tx = Prisma.TransactionClient | PrismaClient;

// ============ SPEC §6.3 — the stock engine ============
//
// stock_movements is an immutable ledger; every quantity change is an inserted
// row and the product cache columns are updated in the SAME transaction
// (SPEC §14 integrity rule 2). qty is signed by its effect on availability:
//
//   physical pool  → products.stock_qty:
//     IN_PURCHASE +, OUT_SALE −, IN_RETURN +, ADJUST_PLUS +, ADJUST_MINUS −
//   reserved pool  → products.reserved_qty (note the sign flip):
//     RESERVE − (reserved goes UP), RELEASE_RESERVE + (reserved goes DOWN)
//
// available = stock_qty − reserved_qty = SUM(qty) over ALL rows.
//
// Order lifecycle (SPEC §1.3): RESERVE at CONFIRMED; RELEASE_RESERVE + OUT_SALE
// at PACKED; RELEASE_RESERVE on cancel/hold; IN_RETURN restores after RETURNED
// or a cancel that happens post-packing. All transitions are LEDGER-DRIVEN —
// they reverse what the ledger says this order holds, not what the current
// items/BOM say — so edits, BOM changes and re-confirmations never desync.

const RESERVE_TYPES: StockMovementType[] = ["RESERVE", "RELEASE_RESERVE"];

export interface MovementInput {
  productId: number;
  type: StockMovementType;
  qty: number; // signed, see convention above
  refTable?: "orders" | "purchases" | null;
  refId?: number | null;
  reason?: string | null;
}

// The single write path for stock: inserts ledger rows and bumps the cache
// columns atomically. Never call prisma.stockMovement.create anywhere else.
export async function applyMovements(
  tx: Tx,
  movements: MovementInput[],
  userId: number
) {
  const rows = movements.filter((m) => m.qty !== 0);
  if (rows.length === 0) return;
  await tx.stockMovement.createMany({
    data: rows.map((m) => ({
      productId: m.productId,
      type: m.type,
      qty: m.qty,
      refTable: m.refTable ?? null,
      refId: m.refId ?? null,
      reason: m.reason ?? null,
      createdBy: userId,
    })),
  });
  for (const m of rows) {
    await tx.product.update({
      where: { id: m.productId },
      data: RESERVE_TYPES.includes(m.type)
        ? { reservedQty: { increment: -m.qty } }
        : { stockQty: { increment: m.qty } },
    });
  }
}

// ---------- order requirements (BOM expansion, SPEC §6.2) ----------

// What an order needs from stock, per stock-tracked product: PRODUCT lines
// count themselves, PACKAGE lines expand to qty × each BOM component.
// Non-stock-tracked products (perishables, §6.1) never touch the ledger.
export async function orderStockRequirements(
  tx: Tx,
  orderId: number
): Promise<Map<number, number>> {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    include: {
      product: { select: { id: true, isStockTracked: true } },
      package: {
        include: {
          items: {
            include: { product: { select: { id: true, isStockTracked: true } } },
          },
        },
      },
    },
  });
  const need = new Map<number, number>();
  const add = (productId: number, qty: number) =>
    need.set(productId, (need.get(productId) ?? 0) + qty);
  for (const it of items) {
    if (it.itemType === "PRODUCT" && it.product?.isStockTracked) {
      add(it.product.id, it.qty);
    } else if (it.itemType === "PACKAGE" && it.package) {
      for (const bom of it.package.items) {
        if (bom.product.isStockTracked) add(bom.product.id, it.qty * bom.qty);
      }
    }
  }
  return need;
}

// ---------- ledger nets for one order ----------

export interface OrderStockNets {
  reserved: Map<number, number>; // per product: qty currently held as reserved
  deducted: Map<number, number>; // per product: qty currently out as sold
}

// What the ledger says this order currently holds. reserved = −Σ(RESERVE +
// RELEASE_RESERVE); deducted = −Σ(OUT_SALE + IN_RETURN).
export async function orderStockNets(
  tx: Tx,
  orderId: number
): Promise<OrderStockNets> {
  const rows = await tx.stockMovement.groupBy({
    by: ["productId", "type"],
    where: { refTable: "orders", refId: orderId },
    _sum: { qty: true },
  });
  const reserved = new Map<number, number>();
  const deducted = new Map<number, number>();
  for (const r of rows) {
    const sum = r._sum.qty ?? 0;
    if (RESERVE_TYPES.includes(r.type)) {
      reserved.set(r.productId, (reserved.get(r.productId) ?? 0) - sum);
    } else {
      deducted.set(r.productId, (deducted.get(r.productId) ?? 0) - sum);
    }
  }
  return { reserved, deducted };
}

// ---------- lifecycle hooks (SPEC §1.3) ----------

// Re-point this order's reservations at `target` quantities, emitting only the
// deltas. Used on entering CONFIRMED and when a CONFIRMED order is edited.
async function setReservations(
  tx: Tx,
  orderId: number,
  target: Map<number, number>,
  current: Map<number, number>,
  userId: number,
  reason: string | null = null
) {
  const productIds = new Set([...target.keys(), ...current.keys()]);
  const movements: MovementInput[] = [];
  for (const productId of productIds) {
    const delta = (target.get(productId) ?? 0) - (current.get(productId) ?? 0);
    if (delta > 0) {
      movements.push({
        productId,
        type: "RESERVE",
        qty: -delta,
        refTable: "orders",
        refId: orderId,
        reason,
      });
    } else if (delta < 0) {
      movements.push({
        productId,
        type: "RELEASE_RESERVE",
        qty: -delta,
        refTable: "orders",
        refId: orderId,
        reason,
      });
    }
  }
  await applyMovements(tx, movements, userId);
}

// Reservations follow the CONFIRMED status: sync to the current items when a
// CONFIRMED order is created or edited. Anything the ledger shows as already
// deducted (packed → on-hold → confirmed round trips) is not re-reserved.
export async function syncReservations(tx: Tx, orderId: number, userId: number) {
  const need = await orderStockRequirements(tx, orderId);
  const nets = await orderStockNets(tx, orderId);
  const target = new Map<number, number>();
  for (const [productId, qty] of need) {
    target.set(productId, Math.max(qty - (nets.deducted.get(productId) ?? 0), 0));
  }
  await setReservations(tx, orderId, target, nets.reserved, userId);
}

// PACKED (SPEC §1.3/§6.2): the reservation converts into a physical deduction —
// RELEASE_RESERVE + OUT_SALE per component — and unit_cost_snapshot freezes on
// the order items (SPEC §14 integrity rule 4). Fails if on-hand is short.
export async function deductStockAtPack(tx: Tx, orderId: number, userId: number) {
  const need = await orderStockRequirements(tx, orderId);
  const nets = await orderStockNets(tx, orderId);

  // release the full reservation…
  await setReservations(tx, orderId, new Map(), nets.reserved, userId);

  // …and deduct whatever is not already out (normally everything)
  const movements: MovementInput[] = [];
  for (const [productId, qty] of need) {
    const toDeduct = qty - (nets.deducted.get(productId) ?? 0);
    if (toDeduct <= 0) continue;
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { name: true, stockQty: true },
    });
    if (product.stockQty < toDeduct) {
      throw new AuthzError(
        400,
        `Insufficient stock to pack: ${product.name} needs ${toDeduct}, on hand ${product.stockQty}`
      );
    }
    movements.push({
      productId,
      type: "OUT_SALE",
      qty: -toDeduct,
      refTable: "orders",
      refId: orderId,
    });
  }
  await applyMovements(tx, movements, userId);
  await freezeCostSnapshots(tx, orderId);
}

// unit_cost_snapshot at PACKED: PRODUCT lines freeze the product's current
// weighted-avg cost; PACKAGE lines freeze Σ(component avg cost × BOM qty) for
// one package (incl. per-order components — their cost is still real).
// Custom lines have no catalog cost → stay null.
async function freezeCostSnapshots(tx: Tx, orderId: number) {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    include: {
      product: { select: { avgCost: true } },
      package: {
        include: { items: { include: { product: { select: { avgCost: true } } } } },
      },
    },
  });
  for (const it of items) {
    let cost: number | null = null;
    if (it.itemType === "PRODUCT" && it.product) {
      cost = Number(it.product.avgCost);
    } else if (it.itemType === "PACKAGE" && it.package) {
      cost = it.package.items.reduce(
        (s, bom) => s + bom.qty * Number(bom.product.avgCost),
        0
      );
    }
    if (cost != null) {
      await tx.orderItem.update({
        where: { id: it.id },
        data: { unitCostSnapshot: round2(cost) },
      });
    }
  }
}

// Cancel / return / hold: give back whatever the ledger says this order holds.
// CANCELLED and RETURNED release the reservation AND restore deducted stock
// (IN_RETURN); ON_HOLD only releases the reservation (a packed box stays packed).
export async function releaseOrderStock(
  tx: Tx,
  orderId: number,
  userId: number,
  opts: { restoreDeducted: boolean; reason?: string }
) {
  const nets = await orderStockNets(tx, orderId);
  await setReservations(
    tx,
    orderId,
    new Map(),
    nets.reserved,
    userId,
    opts.reason ?? null
  );
  if (!opts.restoreDeducted) return;
  const movements: MovementInput[] = [];
  for (const [productId, qty] of nets.deducted) {
    if (qty <= 0) continue;
    movements.push({
      productId,
      type: "IN_RETURN",
      qty,
      refTable: "orders",
      refId: orderId,
      reason: opts.reason ?? null,
    });
  }
  await applyMovements(tx, movements, userId);
}

// One hook for the status route — keeps the whole lifecycle in a single place.
export async function syncStockForStatus(
  tx: Tx,
  orderId: number,
  to: string,
  userId: number,
  note?: string | null
) {
  switch (to) {
    case "CONFIRMED":
      await syncReservations(tx, orderId, userId);
      break;
    case "PACKED":
      await deductStockAtPack(tx, orderId, userId);
      break;
    case "ON_HOLD":
      await releaseOrderStock(tx, orderId, userId, {
        restoreDeducted: false,
        reason: "Order on hold",
      });
      break;
    case "CANCELLED":
      await releaseOrderStock(tx, orderId, userId, {
        restoreDeducted: true,
        reason: note ? `Cancelled: ${note}` : "Order cancelled",
      });
      break;
    case "RETURNED":
      // SPEC §1.3 — restore is gated by the transition itself, which requires
      // a Manager/Admin-level permission (orders.edit).
      await releaseOrderStock(tx, orderId, userId, {
        restoreDeducted: true,
        reason: note ? `Returned: ${note}` : "Order returned",
      });
      break;
  }
}

// ---------- purchases (SPEC §6.3) ----------

const round2 = (n: number) => Math.round(n * 100) / 100;

// Weighted-average cost (SPEC §6.1): existing on-hand value plus the incoming
// line, over the combined quantity. A non-positive on-hand contributes nothing
// (negative stock must not distort the average).
export function weightedAvgCost(
  onHandQty: number,
  currentAvg: number,
  inQty: number,
  inUnitCost: number
): number {
  const base = Math.max(onHandQty, 0);
  if (base + inQty <= 0) return currentAvg;
  return round2((base * currentAvg + inQty * inUnitCost) / (base + inQty));
}

export interface PurchaseLineInput {
  productId: number;
  qty: number;
  unitCost: number;
}

// Auto-created expense category for purchase entries (SPEC §6.3/§9.1).
export const PURCHASE_EXPENSE_CATEGORY = "Product Purchase";

// Purchase entry: stock in + weighted-avg recompute + IN_PURCHASE rows +
// auto-expense, all in the caller's transaction.
export async function applyPurchase(
  tx: Tx,
  opts: {
    supplierName: string;
    purchaseDate: Date;
    paymentStatus: "PAID" | "DUE" | "PARTIAL";
    notes: string | null;
    lines: PurchaseLineInput[];
    userId: number;
  }
) {
  const totalAmount = round2(
    opts.lines.reduce((s, l) => s + l.qty * l.unitCost, 0)
  );
  const purchase = await tx.purchase.create({
    data: {
      supplierName: opts.supplierName,
      purchaseDate: opts.purchaseDate,
      totalAmount,
      paymentStatus: opts.paymentStatus,
      notes: opts.notes,
      createdBy: opts.userId,
      updatedBy: opts.userId,
      items: {
        create: opts.lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          unitCost: round2(l.unitCost),
          lineTotal: round2(l.qty * l.unitCost),
        })),
      },
    },
  });

  for (const line of opts.lines) {
    const product = await tx.product.findUniqueOrThrow({
      where: { id: line.productId },
      select: { stockQty: true, avgCost: true },
    });
    await tx.product.update({
      where: { id: line.productId },
      data: {
        avgCost: weightedAvgCost(
          product.stockQty,
          Number(product.avgCost),
          line.qty,
          line.unitCost
        ),
        updatedBy: opts.userId,
      },
    });
    await applyMovements(
      tx,
      [
        {
          productId: line.productId,
          type: "IN_PURCHASE",
          qty: line.qty,
          refTable: "purchases",
          refId: purchase.id,
        },
      ],
      opts.userId
    );
  }

  // SPEC §6.3: the purchase auto-creates its expense record (product
  // purchase cost), linked via ref so it is never double-entered.
  const category = await tx.expenseCategory.upsert({
    where: { name: PURCHASE_EXPENSE_CATEGORY },
    update: {},
    create: { name: PURCHASE_EXPENSE_CATEGORY, costType: "VARIABLE" },
  });
  await tx.expense.create({
    data: {
      expenseDate: opts.purchaseDate,
      categoryId: category.id,
      amount: totalAmount,
      notes: `Purchase from ${opts.supplierName}`,
      refTable: "purchases",
      refId: purchase.id,
      createdBy: opts.userId,
      updatedBy: opts.userId,
    },
  });

  return purchase;
}
