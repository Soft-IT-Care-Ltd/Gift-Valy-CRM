// ROUND3 R3-2 (extra price per choice option) and R3-3 (Packing prints
// invoices) against the dev database. Every test runs inside ONE transaction
// that is rolled back, so the catalog, orders and order_sequences are left
// untouched: test orders carry TEST- numbers and never go near the counter
// (CLAUDE.md rule 6). Run: npm run test:round3 (needs DATABASE_URL).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { prisma as appPrisma } from "../lib/db";
import { ROLE_MATRIX } from "../lib/permissions";
import {
  frozenExtrasForOrder,
  orderCoreSchema,
  orderScopeWhere,
  resolveItemsAndTotals,
} from "../lib/orders";
import { loadInvoiceOrder } from "../lib/invoice";
import {
  PACKING_PRINT_REFUSED,
  invoicePdfHandler,
  printInvoicesHandler,
} from "../lib/invoice-print";
import type { OrderStatusValue } from "../lib/order-constants";

const prisma = new PrismaClient();
const ROLLBACK = new Error("rollback");
after(async () => {
  await prisma.$disconnect();
  await appPrisma.$disconnect();
});

type Tx = Prisma.TransactionClient;

/** Run `fn` in a transaction that never commits. */
async function inRollback(fn: (tx: Tx) => Promise<void>) {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        await fn(tx);
        throw ROLLBACK;
      },
      { timeout: 120_000, maxWait: 20_000 }
    ),
    (e) => {
      if (e === ROLLBACK) return true;
      throw e; // a real failure inside the transaction
    }
  );
}

const sessionOf = (id: number) => ({ user: { id }, expires: "" }) as unknown as Session;
const isStatus = (status: number) => (e: unknown) =>
  (e as { status?: number }).status === status;

// ---------- fixture: the Eid Hamper ----------
//   Saree Set (৳500): choice "Saree colour" Red +0 (default) | Blue +300
//   Eid Hamper (৳1000, floor ৳800):
//     1 Dairy Milk + 2 × Saree Set + choice "Card" Gold +150 | Silver −50 (default)
//   One hamper, Blue + Gold = 1000 + 2×300 + 150 = ৳1750, floor ৳1550.
interface Fixture {
  hamperId: number;
  gSaree: number;
  gCard: number;
  red: number;
  blue: number;
  gold: number;
  silver: number;
  blueOptionId: number;
}

async function hamperFixture(tx: Tx): Promise<Fixture> {
  const cat = await tx.category.create({ data: { name: `TEST-R3 category ${Date.now()}` } });
  const mk = (sku: string, name: string) =>
    tx.product.create({ data: { sku: `TEST-R3-${sku}`, name, categoryId: cat.id, sellingPrice: 0 } });
  const [milk, red, blue, gold, silver] = await Promise.all([
    mk("MILK", "R3 Dairy Milk"),
    mk("RED", "R3 Red saree"),
    mk("BLUE", "R3 Blue saree"),
    mk("GOLD", "R3 Gold card"),
    mk("SILVER", "R3 Silver card"),
  ]);
  const set = await tx.package.create({
    data: {
      code: "TEST-R3-SET",
      name: "R3 Saree Set",
      sellingPrice: 500,
      items: {
        create: {
          kind: "CHOICE",
          choiceLabel: "Saree colour",
          qty: 1,
          options: {
            create: [
              { productId: red.id, isDefault: true, extraPrice: 0 },
              { productId: blue.id, isDefault: false, extraPrice: 300 },
            ],
          },
        },
      },
    },
    include: { items: { include: { options: true } } },
  });
  const hamper = await tx.package.create({
    data: { code: "TEST-R3-HAMPER", name: "R3 Eid Hamper", sellingPrice: 1000, priceFloor: 800 },
  });
  await tx.packageItem.create({ data: { packageId: hamper.id, kind: "PRODUCT", productId: milk.id, qty: 1 } });
  await tx.packageItem.create({ data: { packageId: hamper.id, kind: "PACKAGE", childPackageId: set.id, qty: 2 } });
  const card = await tx.packageItem.create({
    data: {
      packageId: hamper.id,
      kind: "CHOICE",
      choiceLabel: "Card",
      qty: 1,
      options: {
        create: [
          { productId: gold.id, isDefault: false, extraPrice: 150 },
          { productId: silver.id, isDefault: true, extraPrice: -50 },
        ],
      },
    },
  });
  const sareeGroup = set.items[0];
  return {
    hamperId: hamper.id,
    gSaree: sareeGroup.id,
    gCard: card.id,
    red: red.id,
    blue: blue.id,
    gold: gold.id,
    silver: silver.id,
    blueOptionId: sareeGroup.options.find((o) => o.productId === blue.id)!.id,
  };
}

function payload(
  f: Fixture,
  line: { qty: number; unitPrice: number; picks?: Record<number, number> | null }
) {
  return orderCoreSchema.parse({
    recipientName: "R3 Recipient",
    recipientPhoneBd: "01700000000",
    deliveryAddress: "R3 test address, Dhaka",
    items: [
      {
        itemType: "PACKAGE",
        packageId: f.hamperId,
        qty: line.qty,
        unitPrice: line.unitPrice,
        choiceSelections:
          line.picks === null
            ? null
            : Object.fromEntries(
                Object.entries(line.picks ?? {}).map(([g, p]) => [String(g), p])
              ),
      },
    ],
  });
}

let orderSeq = 0;
async function testOrder(
  tx: Tx,
  status: OrderStatusValue,
  opts: {
    salesExecutiveId: number;
    items?: Prisma.OrderItemCreateWithoutOrderInput[];
  }
) {
  const n = String(++orderSeq).padStart(4, "0");
  const customer = await tx.customer.create({
    data: { name: `R3 Customer ${n}`, phoneForeign: `+96650000${n}${Date.now() % 1000}`, country: "Saudi Arabia" },
  });
  const items = opts.items ?? [];
  const subtotal = items.reduce((s, i) => s + Number(i.lineTotal), 0) || 500;
  return tx.order.create({
    data: {
      orderNo: `${status === "DRAFT" ? "DRAFT-TEST-R3" : "TEST-R3"}-${n}`,
      customerId: customer.id,
      recipientName: "R3 Recipient",
      recipientPhoneBd: "01700000000",
      deliveryAddress: "R3 test address, Dhaka",
      district: "Dhaka",
      thana: "Dhanmondi",
      subtotal,
      discount: 0,
      courierChargeCustomer: 0,
      totalAmount: subtotal,
      advanceAmount: 0,
      dueAmount: subtotal,
      codAmount: subtotal,
      status,
      salesExecutiveId: opts.salesExecutiveId,
      items: {
        create: items.length
          ? items
          : [{ itemType: "PACKAGE", customName: "R3 custom box", qty: 1, unitPrice: 500, lineTotal: 500 }],
      },
    },
  });
}

// =====================================================================
// R3-2 — extra price per choice option
// =====================================================================
describe("R3-2 choice extra prices — the order API", () => {
  test("nested package × qty 2: price, line total and the saved picks", async () => {
    await inRollback(async (tx) => {
      const f = await hamperFixture(tx);
      const picks = { [f.gSaree]: f.blue, [f.gCard]: f.gold };
      const totals = await resolveItemsAndTotals(tx, payload(f, { qty: 2, unitPrice: 1750, picks }));
      const [line] = totals.lines;
      assert.equal(line.priceFloor, 1550); // 800 + 2×300 + 150
      assert.equal(line.lineTotal, 3500); // 1750 × 2
      assert.equal(totals.subtotal, 3500);
      assert.deepEqual(totals.floorBreaches, []);
      assert.deepEqual(
        line.choiceSelections?.map((s) => [s.groupId, s.productId, s.extraPrice, s.qty]),
        [
          [f.gSaree, f.blue, 300, 2],
          [f.gCard, f.gold, 150, 1],
        ]
      );
      // No picks sent → the defaults, whose extras are in the starting price.
      const defaults = await resolveItemsAndTotals(tx, payload(f, { qty: 1, unitPrice: 950, picks: null }));
      assert.equal(defaults.lines[0].priceFloor, 750); // 800 + 0 − 50
      assert.deepEqual(
        defaults.lines[0].choiceSelections?.map((s) => [s.productId, s.extraPrice]),
        [
          [f.red, 0],
          [f.silver, -50],
        ]
      );
    });
  });

  test("the price floor rises with the picks' extras", async () => {
    await inRollback(async (tx) => {
      const f = await hamperFixture(tx);
      const picks = { [f.gSaree]: f.blue, [f.gCard]: f.gold };
      const below = await resolveItemsAndTotals(tx, payload(f, { qty: 2, unitPrice: 1549, picks }));
      assert.equal(below.floorBreaches.length, 1);
      assert.match(below.floorBreaches[0], /৳1549 is below the price floor of ৳1550/);
      const at = await resolveItemsAndTotals(tx, payload(f, { qty: 2, unitPrice: 1550, picks }));
      assert.deepEqual(at.floorBreaches, []);
      // An option that isn't in the group is refused.
      await assert.rejects(
        resolveItemsAndTotals(tx, payload(f, { qty: 1, unitPrice: 2000, picks: { [f.gCard]: f.blue } })),
        isStatus(400)
      );
    });
  });

  test("an order saved before the change keeps its price", async () => {
    await inRollback(async (tx) => {
      const f = await hamperFixture(tx);
      const admin = await tx.user.findFirstOrThrow({ where: { role: { name: "Admin" } } });
      // Saved before R3-2: Blue + Gold sold at ৳1000, picks carry no extraPrice.
      const legacy = await testOrder(tx, "CONFIRMED", {
        salesExecutiveId: admin.id,
        items: [
          {
            itemType: "PACKAGE",
            package: { connect: { id: f.hamperId } },
            qty: 1,
            unitPrice: 1000,
            lineTotal: 1000,
            choiceSelections: [
              { groupId: f.gSaree, label: "Saree colour", productId: f.blue, name: "R3 Blue saree" },
              { groupId: f.gCard, label: "Card", productId: f.gold, name: "R3 Gold card" },
            ],
          },
        ],
      });
      // Saved after R3-2 at Blue +300: ৳1750.
      const current = await testOrder(tx, "CONFIRMED", {
        salesExecutiveId: admin.id,
        items: [
          {
            itemType: "PACKAGE",
            package: { connect: { id: f.hamperId } },
            qty: 1,
            unitPrice: 1750,
            lineTotal: 1750,
            choiceSelections: [
              { groupId: f.gSaree, label: "Saree colour", productId: f.blue, name: "R3 Blue saree", extraPrice: 300, qty: 2 },
              { groupId: f.gCard, label: "Card", productId: f.gold, name: "R3 Gold card", extraPrice: 150, qty: 1 },
            ],
          },
        ],
      });

      // The catalog changes: Blue saree now +৳500.
      await tx.packageItemOption.update({ where: { id: f.blueOptionId }, data: { extraPrice: 500 } });

      // Nothing reprices a saved line — not the row, not the invoice data.
      for (const [order, price] of [
        [legacy, 1000],
        [current, 1750],
      ] as const) {
        const item = await tx.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
        assert.equal(Number(item.unitPrice), price);
        assert.equal(Number(item.lineTotal), price);
        const inv = await loadInvoiceOrder(order.id, tx);
        assert.equal(Number(inv.items[0].unitPrice), price);
        assert.equal(Number(inv.totalAmount), price);
      }

      // Editing without touching the picks keeps the extras they were sold
      // at — legacy picks at +৳0 — so the floor doesn't jump and the saved
      // snapshot stays the same.
      const picks = { [f.gSaree]: f.blue, [f.gCard]: f.gold };
      const legacyEdit = await resolveItemsAndTotals(tx, payload(f, { qty: 1, unitPrice: 1000, picks }), {
        frozenExtras: await frozenExtrasForOrder(tx, legacy.id),
      });
      assert.equal(legacyEdit.lines[0].priceFloor, 800);
      assert.deepEqual(legacyEdit.floorBreaches, []);
      assert.deepEqual(legacyEdit.lines[0].choiceSelections?.map((s) => s.extraPrice), [0, 0]);

      const currentEdit = await resolveItemsAndTotals(tx, payload(f, { qty: 1, unitPrice: 1750, picks }), {
        frozenExtras: await frozenExtrasForOrder(tx, current.id),
      });
      assert.equal(currentEdit.lines[0].priceFloor, 1550);
      assert.deepEqual(currentEdit.floorBreaches, []);
      assert.deepEqual(currentEdit.lines[0].choiceSelections?.map((s) => s.extraPrice), [300, 150]);

      // A new order today uses the new extra: 800 + 2×500 + 150.
      const fresh = await resolveItemsAndTotals(tx, payload(f, { qty: 1, unitPrice: 2150, picks }));
      assert.equal(fresh.lines[0].priceFloor, 1950);
    });
  });
});

// =====================================================================
// R3-3 — Packing prints invoices for orders in its queue, 403 elsewhere
// =====================================================================
describe("R3-3 Packing prints invoices", () => {
  const packing = ROLE_MATRIX.Packing;
  const invoiceReq = (id: number) =>
    new Request(`http://localhost:3000/api/orders/${id}/invoice?disposition=inline`);
  const bulkReq = (orderIds: number[]) =>
    new Request("http://localhost:3000/api/orders/print-invoices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderIds }),
    });

  test("the migration granted invoice.print to Packing and every invoice.generate role", async () => {
    const roles = await prisma.role.findMany({
      include: { rolePermissions: { include: { permission: true } } },
    });
    for (const role of roles) {
      const keys = role.rolePermissions.map((rp) => rp.permission.key);
      if (role.name === "Packing" || keys.includes("invoice.generate")) {
        assert.ok(keys.includes("invoice.print"), `${role.name} has invoice.print`);
      }
    }
    assert.ok(packing.includes("invoice.print"));
    assert.ok(!packing.includes("invoice.generate"));
  });

  test("single invoice: Confirmed / Packed / Handed / In transit print; anything else is 403", async () => {
    await inRollback(async (tx) => {
      const admin = await tx.user.findFirstOrThrow({ where: { role: { name: "Admin" } } });
      const ctx = { session: sessionOf(admin.id), permissions: packing };
      for (const status of ["CONFIRMED", "PACKED", "HANDED_TO_COURIER", "IN_TRANSIT"] as const) {
        const o = await testOrder(tx, status, { salesExecutiveId: admin.id });
        const res = await invoicePdfHandler(invoiceReq(o.id), ctx, o.id, tx);
        assert.equal(res.status, 200, status);
        assert.equal(res.headers.get("content-type"), "application/pdf");
        const pdf = Buffer.from(await res.arrayBuffer());
        assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
        // Printing is not generating: no invoice version was created.
        assert.equal(await tx.invoice.count({ where: { orderId: o.id } }), 0);
      }
      for (const status of ["DELIVERED", "COMPLETED", "DRAFT", "ON_HOLD", "CANCELLED", "RETURNED"] as const) {
        const o = await testOrder(tx, status, { salesExecutiveId: admin.id });
        await assert.rejects(invoicePdfHandler(invoiceReq(o.id), ctx, o.id, tx), (e) => {
          assert.equal((e as { status: number }).status, 403, status);
          assert.equal((e as Error).message, PACKING_PRINT_REFUSED);
          return true;
        });
      }
    });
  });

  test("bulk: prints the queue's orders, skips the rest, 403 when none are in the queue", async () => {
    await inRollback(async (tx) => {
      const admin = await tx.user.findFirstOrThrow({ where: { role: { name: "Admin" } } });
      const ctx = { session: sessionOf(admin.id), permissions: packing };
      const confirmed = await testOrder(tx, "CONFIRMED", { salesExecutiveId: admin.id });
      const inTransit = await testOrder(tx, "IN_TRANSIT", { salesExecutiveId: admin.id });
      const delivered = await testOrder(tx, "DELIVERED", { salesExecutiveId: admin.id });
      const draft = await testOrder(tx, "DRAFT", { salesExecutiveId: admin.id });

      const ok = await printInvoicesHandler(bulkReq([confirmed.id, inTransit.id]), ctx, tx);
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get("x-skipped-count"), "0");
      assert.equal(Buffer.from(await ok.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");

      const mixed = await printInvoicesHandler(bulkReq([confirmed.id, delivered.id]), ctx, tx);
      assert.equal(mixed.status, 200);
      assert.equal(mixed.headers.get("x-skipped-count"), "1");

      await assert.rejects(
        printInvoicesHandler(bulkReq([delivered.id, draft.id]), ctx, tx),
        isStatus(403)
      );
    });
  });

  test("Packing gets 403 everywhere else; invoice.print never widens an SE's scope", async () => {
    await inRollback(async (tx) => {
      const admin = await tx.user.findFirstOrThrow({ where: { role: { name: "Admin" } } });
      const session = sessionOf(admin.id);
      const order = await testOrder(tx, "CONFIRMED", { salesExecutiveId: admin.id });

      // The order list / detail / edit / payments routes all scope through
      // orderScopeWhere — Packing has no order view permission.
      await assert.rejects(orderScopeWhere(session, packing), isStatus(403));
      for (const key of ["orders.view_own", "orders.view_team", "orders.view_all", "invoice.generate", "payments.create", "reports.pnl"]) {
        assert.ok(!packing.includes(key), `Packing must not hold ${key}`);
      }

      // Packing with invoice.print taken away (per-user override): nothing.
      const noPrint = { session, permissions: packing.filter((k) => k !== "invoice.print") };
      await assert.rejects(invoicePdfHandler(invoiceReq(order.id), noPrint, order.id, tx), isStatus(403));
      await assert.rejects(printInvoicesHandler(bulkReq([order.id]), noPrint, tx), isStatus(403));

      // An SE holds invoice.print too, but only for their own orders: someone
      // else's Confirmed order stays "not found".
      const se = { session: sessionOf(-1), permissions: ROLE_MATRIX.SalesExecutive };
      const res = await invoicePdfHandler(invoiceReq(order.id), se, order.id, tx);
      assert.equal(res.status, 404);
      await assert.rejects(printInvoicesHandler(bulkReq([order.id]), se, tx), isStatus(400));
    });
  });
});

// =====================================================================
// R3-1 — the category photo is re-encoded: ≤1200 px, WebP, no EXIF
// =====================================================================
describe("R3-1 category photo", () => {
  test("a large JPEG with EXIF becomes a ≤1200 px WebP without metadata", async () => {
    const sharp = (await import("sharp")).default;
    const { processCategoryPhoto, isCategoryPhotoUrl, categoryPhotoAction } = await import(
      "../lib/category-photo"
    );
    const jpeg = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 40, b: 90 } },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: "R3 test", Artist: "phone camera" } })
      .toBuffer();
    assert.ok((await sharp(jpeg).metadata()).exif, "fixture carries EXIF");

    const out = await processCategoryPhoto(jpeg);
    const meta = await sharp(out).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, 1200);
    assert.equal(meta.height, 800);
    assert.equal(meta.exif, undefined);

    // A small image is never enlarged.
    const small = await sharp({
      create: { width: 300, height: 200, channels: 3, background: "#fff" },
    }).png().toBuffer();
    assert.equal((await sharp(await processCategoryPhoto(small)).metadata()).width, 300);

    await assert.rejects(processCategoryPhoto(Buffer.from("not an image")), /readable/);
    assert.ok(isCategoryPhotoUrl("/uploads/category-0b7e5f0a-1c2d-4e5f-8a9b-0c1d2e3f4a5b.webp"));
    assert.ok(!isCategoryPhotoUrl("/uploads/0b7e5f0a-1c2d-4e5f-8a9b-0c1d2e3f4a5b.jpg"));
    assert.ok(!isCategoryPhotoUrl("/uploads/category-../../etc/passwd.webp"));
    assert.equal(categoryPhotoAction(null, "/uploads/a"), "category.photo.add");
    assert.equal(categoryPhotoAction("/uploads/a", "/uploads/b"), "category.photo.replace");
    assert.equal(categoryPhotoAction("/uploads/a", null), "category.photo.remove");
    assert.equal(categoryPhotoAction("/uploads/a", "/uploads/a"), null);
  });
});
