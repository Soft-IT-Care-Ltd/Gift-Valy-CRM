// Seed: 6 roles + permission matrix (SPEC §2), one login per role (plus a 2nd
// Sales Executive so own-vs-others scope is testable), demo catalog
// (8 categories, 10 products, 3 packages — SPEC §6.1/§6.2), demo customers and
// 15 orders across the status lifecycle with payments.
// Idempotent — safe to re-run (upserts everywhere; re-running resets demo
// catalog prices/stock, package BOMs, and wipes/recreates the demo orders).
import { PrismaClient, Prisma, type OrderStatus, type PaymentType, type PaymentMethod, type ShipmentStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  PERMISSION_DEFS,
  ROLE_MATRIX,
  ROLE_NAMES,
} from "../lib/permissions";
import { SEED_EXPENSE_CATEGORIES, AD_COST_CATEGORY } from "../lib/expense-constants";
import { dhakaDateBound } from "../lib/order-constants";
import {
  ATTENDANCE_SETTINGS_KEY,
  DEFAULT_ATTENDANCE_SETTINGS,
  attendanceSettingsToJson,
  dayStartUTC,
  deriveCheckInStatus,
  dhakaMinutesOfDay,
  dhakaYmd,
} from "../lib/attendance-constants";

const prisma = new PrismaClient();

async function main() {
  // 1. Permissions
  for (const def of PERMISSION_DEFS) {
    await prisma.permission.upsert({
      where: { key: def.key },
      update: {},
      create: { key: def.key },
    });
  }
  const permissions = await prisma.permission.findMany();
  const permIdByKey = new Map(permissions.map((p) => [p.key, p.id]));

  // 2. Roles + role_permissions matrix
  const roleIdByName = new Map<string, number>();
  for (const name of ROLE_NAMES) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    roleIdByName.set(name, role.id);

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: ROLE_MATRIX[name].map((key) => {
        const permissionId = permIdByKey.get(key);
        if (!permissionId) throw new Error(`Unknown permission key: ${key}`);
        return { roleId: role.id, permissionId };
      }),
    });
  }

  // 3. Demo team
  const team = await prisma.team.upsert({
    where: { name: "Team Alpha" },
    update: {},
    create: { name: "Team Alpha" },
  });

  // 4. Users — Admin (owner) + TL (Sakib, SPEC §2.1) + 2 demo Sales Executives.
  // Demo passwords documented in README; mustChangePassword=false so role
  // testing works out of the box. Users created later via Admin UI default to true.
  const users = [
    {
      name: "M.H. Neshad",
      email: "mh.neshad39@gmail.com",
      role: "Admin",
      password: "Admin@GV2026",
      teamId: null as number | null,
    },
    {
      name: "Sakib",
      email: "sakib@giftvaly.com",
      role: "TeamLeader",
      password: "Team@GV2026",
      teamId: team.id,
    },
    {
      name: "Sanjoy",
      email: "sanjoy@giftvaly.com",
      role: "SalesExecutive",
      password: "Sales@GV2026",
      teamId: team.id,
    },
    {
      name: "Partho",
      email: "partho@giftvaly.com",
      role: "SalesExecutive",
      password: "Sales@GV2026",
      teamId: team.id,
    },
    {
      name: "Rafiq",
      email: "manager@giftvaly.com",
      role: "Manager",
      password: "Manager@GV2026",
      teamId: null as number | null,
    },
    {
      name: "Habib",
      email: "packing@giftvaly.com",
      role: "Packing",
      password: "Pack@GV2026",
      teamId: null as number | null,
    },
    {
      name: "Tania",
      email: "accounts@giftvaly.com",
      role: "Accounts",
      password: "Acc@GV2026",
      teamId: null as number | null,
    },
  ];

  const userIdByEmail = new Map<string, number>();
  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    const saved = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        roleId: roleIdByName.get(u.role)!,
        teamId: u.teamId,
        isActive: true,
      },
      create: {
        name: u.name,
        email: u.email,
        passwordHash,
        roleId: roleIdByName.get(u.role)!,
        teamId: u.teamId,
        isActive: true,
        isOnboarding: false,
        mustChangePassword: false,
        joinedAt: dhakaDateBound(new Date()), // @db.Date — today's Dhaka day
      },
    });
    userIdByEmail.set(u.email, saved.id);
    if (u.role === "TeamLeader") {
      await prisma.team.update({
        where: { id: team.id },
        data: { leaderUserId: saved.id },
      });
    }
  }

  // 4b. Settings — SE order edit window (§4.2), default 30 minutes.
  await prisma.setting.upsert({
    where: { key: "order_edit_window_minutes" },
    update: {},
    create: { key: "order_edit_window_minutes", value: 30 },
  });

  // 4b-bis. Attendance office-hours settings (§11) + demo attendance for today
  // so the "who's in" widget and R10 report have data out of the box.
  await prisma.setting.upsert({
    where: { key: ATTENDANCE_SETTINGS_KEY },
    update: {},
    create: {
      key: ATTENDANCE_SETTINGS_KEY,
      value: attendanceSettingsToJson(DEFAULT_ATTENDANCE_SETTINGS),
    },
  });
  {
    const now = new Date();
    const todayYmd = dhakaYmd(now);
    const date = dayStartUTC(todayYmd);
    const at = (hhmm: string) => new Date(`${todayYmd}T${hhmm}:00+06:00`);
    const mark = async (email: string, checkIn: string, checkOut: string | null) => {
      const userId = userIdByEmail.get(email);
      if (!userId) return;
      const checkInAt = at(checkIn);
      const status = deriveCheckInStatus(
        dhakaMinutesOfDay(checkInAt),
        DEFAULT_ATTENDANCE_SETTINGS
      );
      await prisma.attendance.upsert({
        where: { userId_date: { userId, date } },
        update: {},
        create: {
          userId,
          date,
          checkInAt,
          checkOutAt: checkOut ? at(checkOut) : null,
          status,
          createdBy: userId,
          updatedBy: userId,
        },
      });
    };
    await mark("sakib@giftvaly.com", "09:58", null); // present, still in
    await mark("sanjoy@giftvaly.com", "10:32", null); // late, still in
    await mark("mh.neshad39@gmail.com", "09:45", "18:10"); // present, checked out

    // One approved leave spanning today + the next two days (§11) so "LEAVE" days
    // show on the sheet and "on leave" shows on the dashboard widget.
    const parthoId = userIdByEmail.get("partho@giftvaly.com");
    const adminId = userIdByEmail.get("mh.neshad39@gmail.com") ?? null;
    if (parthoId) {
      const leaveTo = dayStartUTC(dhakaYmd(new Date(now.getTime() + 2 * 86_400_000)));
      const has = await prisma.leaveRequest.findFirst({
        where: { userId: parthoId, fromDate: date },
      });
      if (!has) {
        await prisma.leaveRequest.create({
          data: {
            userId: parthoId,
            fromDate: date,
            toDate: leaveTo,
            reason: "Family event",
            status: "APPROVED",
            approvedBy: adminId,
            approvedAt: now,
            createdBy: parthoId,
            updatedBy: parthoId,
          },
        });
      }
    }

    // A pending leave request awaiting approval (§11) so the queue isn't empty.
    const habibId = userIdByEmail.get("packing@giftvaly.com");
    if (habibId) {
      const has = await prisma.leaveRequest.findFirst({
        where: { userId: habibId, status: "PENDING" },
      });
      if (!has) {
        const nextWeekYmd = dhakaYmd(new Date(now.getTime() + 7 * 86_400_000));
        await prisma.leaveRequest.create({
          data: {
            userId: habibId,
            fromDate: dayStartUTC(nextWeekYmd),
            toDate: dayStartUTC(nextWeekYmd),
            reason: "Personal work",
            status: "PENDING",
            createdBy: habibId,
            updatedBy: habibId,
          },
        });
      }
    }
  }

  // 4c. Couriers (SPEC §7) — COD fee % + a few per-district zone charges.
  const demoCouriers = [
    { name: "Steadfast", contact: "16460", codFeePercent: 1.0, zones: [["Dhaka", 60], ["Chattogram", 100], ["Sylhet", 120], ["Rangpur", 130]] },
    { name: "Pathao", contact: "09678100800", codFeePercent: 1.0, zones: [["Dhaka", 70], ["Gazipur", 80], ["Cumilla", 110]] },
    { name: "RedX", contact: "09610990880", codFeePercent: 0.8, zones: [["Dhaka", 65], ["Khulna", 120], ["Barishal", 130]] },
    { name: "Sundarban", contact: "09610002000", codFeePercent: 0.5, zones: [["Dhaka", 60], ["Rajshahi", 120]] },
  ] as const;
  const courierIdByName = new Map<string, number>();
  const courierFeeByName = new Map<string, number>();
  for (const c of demoCouriers) {
    const saved = await prisma.courier.upsert({
      where: { name: c.name },
      update: { contact: c.contact, codFeePercent: c.codFeePercent, isActive: true },
      create: { name: c.name, contact: c.contact, codFeePercent: c.codFeePercent },
    });
    courierIdByName.set(c.name, saved.id);
    courierFeeByName.set(c.name, c.codFeePercent);
    await prisma.courierZoneCharge.deleteMany({ where: { courierId: saved.id } });
    await prisma.courierZoneCharge.createMany({
      data: c.zones.map(([district, charge]) => ({
        courierId: saved.id,
        district: district as string,
        charge: charge as number,
      })),
    });
  }

  // 4d. Wallets (SPEC §8) — company receiving accounts. Payments are attributed
  // to one by method; courier COD is settled into the bank account.
  const demoWallets = [
    { name: "bKash — Merchant", type: "BKASH" as const, accountNo: "01700-000001" },
    { name: "Nagad — Merchant", type: "NAGAD" as const, accountNo: "01800-000002" },
    { name: "Rocket — Agent", type: "ROCKET" as const, accountNo: "01900-000003" },
    { name: "City Bank — Current", type: "BANK" as const, accountNo: "1502-XXXX-9931" },
    { name: "Office cash box", type: "CASH" as const, accountNo: null },
  ];
  const walletIdByType = new Map<string, number>();
  for (const w of demoWallets) {
    const saved = await prisma.wallet.upsert({
      where: { name: w.name },
      update: { type: w.type, accountNo: w.accountNo, isActive: true },
      create: { name: w.name, type: w.type, accountNo: w.accountNo },
    });
    walletIdByType.set(w.type, saved.id);
  }
  // Receiving wallet per payment method (COURIER_COD lands in the bank; OTHER
  // has no dedicated account and stays unassigned).
  const bankWalletId = walletIdByType.get("BANK")!;
  const walletIdByMethod = new Map<string, number | null>([
    ["BKASH", walletIdByType.get("BKASH")!],
    ["NAGAD", walletIdByType.get("NAGAD")!],
    ["ROCKET", walletIdByType.get("ROCKET")!],
    ["BANK", bankWalletId],
    ["CASH", walletIdByType.get("CASH")!],
    ["COURIER_COD", bankWalletId],
    ["OTHER", null],
  ]);

  // 5. Categories (SPEC §6.1 — editable list)
  const categoryNames = [
    "Teddy", "Chocolate", "Saree", "Cosmetics",
    "Cake", "Flowers", "Card", "Gift Wrap",
  ];
  const catIdByName = new Map<string, number>();
  for (const name of categoryNames) {
    const cat = await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    catIdByName.set(name, cat.id);
  }

  // 6. Products — SKUs fixed here so the seed stays idempotent; API-created
  // products continue the same GV-#### sequence (derived from row id).
  // Cake & Flowers are perishable → not stock-tracked (bought per order).
  const demoProducts = [
    { sku: "GV-0001", name: "Teddy Bear (M)", category: "Teddy", unit: "pcs", avgCost: 450, sellingPrice: 750, priceFloor: 650, stockQty: 25, lowStockThreshold: 5, isStockTracked: true },
    { sku: "GV-0002", name: "Teddy Bear (L)", category: "Teddy", unit: "pcs", avgCost: 700, sellingPrice: 1200, priceFloor: 1000, stockQty: 12, lowStockThreshold: 3, isStockTracked: true },
    { sku: "GV-0003", name: "Chocolate Box (Ferrero 16pc)", category: "Chocolate", unit: "box", avgCost: 950, sellingPrice: 1400, priceFloor: 1250, stockQty: 30, lowStockThreshold: 8, isStockTracked: true },
    { sku: "GV-0004", name: "Dairy Milk Silk Combo", category: "Chocolate", unit: "box", avgCost: 480, sellingPrice: 750, priceFloor: 650, stockQty: 40, lowStockThreshold: 10, isStockTracked: true },
    { sku: "GV-0005", name: "Jamdani Saree", category: "Saree", unit: "pcs", avgCost: 2200, sellingPrice: 3500, priceFloor: 3000, stockQty: 8, lowStockThreshold: 2, isStockTracked: true },
    { sku: "GV-0006", name: "Cosmetics Gift Set", category: "Cosmetics", unit: "set", avgCost: 1100, sellingPrice: 1800, priceFloor: 1500, stockQty: 15, lowStockThreshold: 4, isStockTracked: true },
    { sku: "GV-0007", name: "Birthday Cake 1kg (Vanilla)", category: "Cake", unit: "pcs", avgCost: 550, sellingPrice: 900, priceFloor: 800, stockQty: 0, lowStockThreshold: 0, isStockTracked: false },
    { sku: "GV-0008", name: "Red Rose Bouquet (12)", category: "Flowers", unit: "pcs", avgCost: 350, sellingPrice: 700, priceFloor: 550, stockQty: 0, lowStockThreshold: 0, isStockTracked: false },
    { sku: "GV-0009", name: "Greeting Card (Premium)", category: "Card", unit: "pcs", avgCost: 40, sellingPrice: 100, priceFloor: 80, stockQty: 100, lowStockThreshold: 20, isStockTracked: true },
    { sku: "GV-0010", name: "Gift Wrap & Ribbon", category: "Gift Wrap", unit: "pcs", avgCost: 25, sellingPrice: 60, priceFloor: 50, stockQty: 200, lowStockThreshold: 30, isStockTracked: true },
  ];
  const productIdBySku = new Map<string, number>();
  for (const p of demoProducts) {
    const { sku, category, ...fields } = p;
    // reservedQty resets to 0 on every seed run; the demo CONFIRMED orders
    // below re-establish reservations so cache and ledger stay consistent.
    const data = { ...fields, categoryId: catIdByName.get(category)!, reservedQty: 0 };
    const product = await prisma.product.upsert({
      where: { sku },
      update: data,
      create: { sku, ...data },
    });
    productIdBySku.set(sku, product.id);
  }

  // 7. Packages + BOMs (SPEC §6.2). Items are replaced on each seed run.
  const demoPackages = [
    {
      code: "PKG-001",
      name: "Probashi Premium Package",
      sellingPrice: 5500, // vs ৳5,810 standalone; cost ৳3,665 → margin ৳1,835
      priceFloor: 4800,
      items: [
        { sku: "GV-0001", qty: 1 }, // Teddy (M)
        { sku: "GV-0003", qty: 1 }, // Chocolate Box
        { sku: "GV-0005", qty: 1 }, // Saree
        { sku: "GV-0009", qty: 1 }, // Greeting Card
        { sku: "GV-0010", qty: 1 }, // Gift Wrap
      ],
    },
    {
      code: "PKG-002",
      name: "Birthday Surprise Combo",
      sellingPrice: 2300, // cost ৳1,390; cake+flowers are per-order
      priceFloor: 2000,
      items: [
        { sku: "GV-0001", qty: 1 }, // Teddy (M)
        { sku: "GV-0007", qty: 1 }, // Birthday Cake (per-order)
        { sku: "GV-0008", qty: 1 }, // Rose Bouquet (per-order)
        { sku: "GV-0009", qty: 1 }, // Greeting Card
      ],
    },
    {
      code: "PKG-003",
      name: "Chocolate Love Bundle",
      sellingPrice: 2800, // cost ৳1,870
      priceFloor: 2500,
      items: [
        { sku: "GV-0003", qty: 1 }, // Chocolate Box
        { sku: "GV-0004", qty: 1 }, // Dairy Milk Combo
        { sku: "GV-0008", qty: 1 }, // Rose Bouquet (per-order)
        { sku: "GV-0009", qty: 1 }, // Greeting Card
        { sku: "GV-0010", qty: 2 }, // Gift Wrap ×2
      ],
    },
  ];
  const packageIdByCode = new Map<string, number>();
  for (const pkg of demoPackages) {
    const { code, items, ...fields } = pkg;
    const saved = await prisma.package.upsert({
      where: { code },
      update: fields,
      create: { code, ...fields },
    });
    packageIdByCode.set(code, saved.id);
    await prisma.packageItem.deleteMany({ where: { packageId: saved.id } });
    await prisma.packageItem.createMany({
      data: items.map((it) => ({
        packageId: saved.id,
        productId: productIdBySku.get(it.sku)!,
        qty: it.qty,
      })),
    });
  }

  // ============ 8. Demo customers (SPEC §3 — probashi payers) ============
  const demoCustomers = [
    { name: "Rahim Uddin", phoneForeign: "+966551234567", country: "KSA" },
    { name: "Karim Hossain", phoneForeign: "+971501112233", country: "UAE" },
    { name: "Fatema Begum", phoneForeign: "+97455667788", country: "Qatar" },
    { name: "Jashim Molla", phoneForeign: "+96599887766", country: "Kuwait" },
    { name: "Nusrat Jahan", phoneForeign: "+60111222333", country: "Malaysia" },
    { name: "Abdul Alim", phoneForeign: "+447700900123", country: "UK" },
    { name: "Sharmin Akter", phoneForeign: "+14165550123", country: "Canada" },
    { name: "Milon Sheikh", phoneForeign: "+6581234567", country: "Singapore" },
  ];
  const customerIdByPhone = new Map<string, number>();
  for (const c of demoCustomers) {
    const saved = await prisma.customer.upsert({
      where: { phoneForeign: c.phoneForeign },
      update: { name: c.name, country: c.country },
      create: c,
    });
    customerIdByPhone.set(c.phoneForeign, saved.id);
  }

  // ============ 9. Demo orders — 15 across the lifecycle (SPEC §1.3/§4/§8) ============
  // Idempotency: every order below belongs to a demo customer, so re-running
  // wipes exactly those orders (payments first — no cascade on payments) and
  // recreates them. Orders created via the app use non-demo customers and survive.
  const demoCustomerIds = [...customerIdByPhone.values()];
  const oldDemo = await prisma.order.findMany({
    where: { customerId: { in: demoCustomerIds } },
    select: { id: true },
  });
  const oldIds = oldDemo.map((o) => o.id);
  await prisma.payment.deleteMany({ where: { orderId: { in: oldIds } } });
  await prisma.order.deleteMany({ where: { id: { in: oldIds } } });

  // Phase-2 derived data is fully regenerated below (opening balances,
  // reservations, and any purchases/expenses), so wipe it for a clean re-seed.
  await prisma.stockMovement.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.purchase.deleteMany({}); // cascades purchase_items

  // Expense categories (SPEC §9.1), each flagged Fixed/Variable. Upserted (never
  // wiped) so the auto categories ("Product Purchase"/"Courier Charge") created by
  // the modules survive alongside these. Captured by name for the demo expenses.
  const expenseCategoryIdByName = new Map<string, number>();
  for (const c of SEED_EXPENSE_CATEGORIES) {
    const saved = await prisma.expenseCategory.upsert({
      where: { name: c.name },
      update: { costType: c.costType },
      create: { name: c.name, costType: c.costType },
    });
    expenseCategoryIdByName.set(c.name, saved.id);
  }

  const daysAgo = (n: number, hour = 10) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  // GV-YYMM- month prefix in Asia/Dhaka — mirrors lib/orders.ts orderNoPrefix
  // (not imported: lib/orders pulls in next-auth, which the seed CLI can't load).
  const prefixFor = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dhaka",
      year: "2-digit",
      month: "2-digit",
    }).formatToParts(date);
    const yy = parts.find((p) => p.type === "year")!.value;
    const mm = parts.find((p) => p.type === "month")!.value;
    return `GV-${yy}${mm}-`;
  };
  // Per-month sequence continues after any surviving (non-demo) orders.
  const nextSeqByPrefix = new Map<string, number>();
  const nextOrderNoFor = async (date: Date) => {
    const prefix = prefixFor(date);
    if (!nextSeqByPrefix.has(prefix)) {
      const last = await prisma.order.findFirst({
        where: { orderNo: { startsWith: prefix } },
        orderBy: { orderNo: "desc" },
        select: { orderNo: true },
      });
      nextSeqByPrefix.set(
        prefix,
        last ? parseInt(last.orderNo.slice(prefix.length), 10) + 1 : 1
      );
    }
    const seq = nextSeqByPrefix.get(prefix)!;
    nextSeqByPrefix.set(prefix, seq + 1);
    return `${prefix}${String(seq).padStart(4, "0")}`;
  };

  const avgCostBySku = new Map(demoProducts.map((p) => [p.sku, p.avgCost]));
  const pkgCostByCode = new Map(
    demoPackages.map((pkg) => [
      pkg.code,
      pkg.items.reduce((s, it) => s + it.qty * avgCostBySku.get(it.sku)!, 0),
    ])
  );
  const priceBySku = new Map(demoProducts.map((p) => [p.sku, p.sellingPrice]));
  const pkgPriceByCode = new Map(demoPackages.map((p) => [p.code, p.sellingPrice]));

  interface DemoLine { sku?: string; pkg?: string; qty: number; unitPrice?: number }
  interface DemoStatusStep { to: OrderStatus; day: number; byEmail: string; note?: string }
  interface DemoPayment {
    type: PaymentType; method: PaymentMethod; amount: number; day: number;
    txn?: string; sender?: string; verified?: boolean;
  }
  interface DemoOrder {
    customerPhone: string; seEmail: string;
    recipientName: string; recipientPhoneBd: string; relation: string;
    address: string; district: string; thana: string; occasion: string | null;
    items: DemoLine[]; discount?: number; courier?: number;
    // chain[0] = status at creation (order createdAt = its day)
    chain: DemoStatusStep[];
    payments: DemoPayment[];
    cancelReason?: string;
    codOverride?: number; // default: max(total − advance, 0); 0 once settled/refund-path
  }

  const SE1 = "sanjoy@giftvaly.com";
  const SE2 = "partho@giftvaly.com";
  const TL = "sakib@giftvaly.com";
  const MGR = "manager@giftvaly.com";
  const PCK = "packing@giftvaly.com";
  const ADM = "mh.neshad39@gmail.com";

  const demoOrders: DemoOrder[] = [
    { // 1 — COMPLETED, advance + COD collected
      customerPhone: "+966551234567", seEmail: SE1,
      recipientName: "Amina Khatun", recipientPhoneBd: "01711000001", relation: "Mother",
      address: "House 12, Road 3, Dhanmondi", district: "Dhaka", thana: "Dhanmondi", occasion: "Eid",
      items: [{ pkg: "PKG-001", qty: 1 }], courier: 150,
      chain: [
        { to: "CONFIRMED", day: 20, byEmail: SE1 },
        { to: "PACKED", day: 19, byEmail: PCK },
        { to: "HANDED_TO_COURIER", day: 18, byEmail: MGR },
        { to: "IN_TRANSIT", day: 18, byEmail: MGR },
        { to: "DELIVERED", day: 17, byEmail: MGR },
        { to: "COMPLETED", day: 16, byEmail: MGR, note: "COD reconciled" },
      ],
      payments: [
        { type: "ADVANCE", method: "BKASH", amount: 2000, day: 20, txn: "DEMO-BK-1001", sender: "+966551234567", verified: true },
        { type: "COD_COURIER", method: "COURIER_COD", amount: 3650, day: 16, verified: true },
      ],
      codOverride: 3650,
    },
    { // 2 — COMPLETED, advance + post-delivery MFS
      customerPhone: "+971501112233", seEmail: SE2,
      recipientName: "Rina Akter", recipientPhoneBd: "01812000002", relation: "Wife",
      address: "Vill: Charpara, PO: Mithapukur", district: "Rangpur", thana: "Mithapukur", occasion: "Anniversary",
      items: [{ sku: "GV-0003", qty: 2 }, { sku: "GV-0009", qty: 1 }], discount: 100, courier: 120,
      chain: [
        { to: "CONFIRMED", day: 18, byEmail: SE2 },
        { to: "PACKED", day: 17, byEmail: PCK },
        { to: "HANDED_TO_COURIER", day: 16, byEmail: MGR },
        { to: "DELIVERED", day: 15, byEmail: MGR },
        { to: "COMPLETED", day: 14, byEmail: MGR },
      ],
      payments: [
        { type: "ADVANCE", method: "NAGAD", amount: 1000, day: 18, txn: "DEMO-NG-1002", sender: "+971501112233", verified: true },
        { type: "POST_DELIVERY_MFS", method: "BKASH", amount: 1920, day: 15, txn: "DEMO-BK-1003", verified: true },
      ],
      codOverride: 0,
    },
    { // 3 — COMPLETED, paid in full up-front by bank
      customerPhone: "+97455667788", seEmail: SE1,
      recipientName: "Shafiq Islam", recipientPhoneBd: "01913000003", relation: "Father",
      address: "Holding 45, College Road", district: "Chattogram", thana: "Kotwali", occasion: "Birthday",
      items: [{ pkg: "PKG-003", qty: 1 }], courier: 100,
      chain: [
        { to: "CONFIRMED", day: 15, byEmail: SE1 },
        { to: "PACKED", day: 14, byEmail: PCK },
        { to: "HANDED_TO_COURIER", day: 13, byEmail: MGR },
        { to: "IN_TRANSIT", day: 13, byEmail: MGR },
        { to: "DELIVERED", day: 12, byEmail: MGR },
        { to: "COMPLETED", day: 11, byEmail: MGR },
      ],
      payments: [
        { type: "ADVANCE", method: "BANK", amount: 2900, day: 15, txn: "DEMO-BA-1004", verified: true },
      ],
      codOverride: 0,
    },
    { // 4 — DELIVERED, COD collected, awaiting completion
      customerPhone: "+96599887766", seEmail: SE2,
      recipientName: "Salma Begum", recipientPhoneBd: "01714000004", relation: "Mother",
      address: "Sadar Road 8", district: "Sylhet", thana: "Sylhet Sadar", occasion: "Mother's Day",
      items: [{ sku: "GV-0005", qty: 1 }], courier: 150,
      chain: [
        { to: "CONFIRMED", day: 12, byEmail: SE2 },
        { to: "PACKED", day: 11, byEmail: PCK },
        { to: "HANDED_TO_COURIER", day: 10, byEmail: MGR },
        { to: "IN_TRANSIT", day: 9, byEmail: MGR },
        { to: "DELIVERED", day: 8, byEmail: MGR },
      ],
      payments: [
        { type: "ADVANCE", method: "BKASH", amount: 1500, day: 12, txn: "DEMO-BK-1005", verified: true },
        { type: "COD_COURIER", method: "COURIER_COD", amount: 2150, day: 8 },
      ],
      codOverride: 2150,
    },
    { // 5 — DELIVERED, COD not yet recorded (due outstanding)
      customerPhone: "+60111222333", seEmail: SE1,
      recipientName: "Tanvir Ahmed", recipientPhoneBd: "01815000005", relation: "Sibling",
      address: "Block C, Mirpur 10", district: "Dhaka", thana: "Mirpur", occasion: "Birthday",
      items: [{ pkg: "PKG-002", qty: 1 }], courier: 100,
      chain: [
        { to: "CONFIRMED", day: 6, byEmail: SE1 },
        { to: "PACKED", day: 5, byEmail: PCK },
        { to: "HANDED_TO_COURIER", day: 4, byEmail: MGR },
        { to: "IN_TRANSIT", day: 3, byEmail: MGR },
        { to: "DELIVERED", day: 1, byEmail: MGR },
      ],
      payments: [
        { type: "ADVANCE", method: "NAGAD", amount: 800, day: 6, txn: "DEMO-NG-1006", verified: true },
      ],
    },
    { // 6 — IN_TRANSIT
      customerPhone: "+447700900123", seEmail: SE2,
      recipientName: "Rokeya Sultana", recipientPhoneBd: "01916000006", relation: "Wife",
      address: "Court Road 22", district: "Cumilla", thana: "Kotwali", occasion: "Just Because",
      items: [{ sku: "GV-0002", qty: 1 }, { sku: "GV-0009", qty: 1 }, { sku: "GV-0010", qty: 1 }], courier: 110,
      chain: [
        { to: "CONFIRMED", day: 5, byEmail: SE2 },
        { to: "PACKED", day: 4, byEmail: PCK },
        { to: "HANDED_TO_COURIER", day: 3, byEmail: MGR },
        { to: "IN_TRANSIT", day: 2, byEmail: MGR },
      ],
      payments: [
        { type: "ADVANCE", method: "BKASH", amount: 500, day: 5, txn: "DEMO-BK-1007", verified: true },
      ],
    },
    { // 7 — HANDED_TO_COURIER, percent discount
      customerPhone: "+14165550123", seEmail: SE1,
      recipientName: "Farida Yasmin", recipientPhoneBd: "01717000007", relation: "Mother",
      address: "Station Road 5", district: "Rajshahi", thana: "Boalia", occasion: "Get Well Soon",
      items: [{ sku: "GV-0006", qty: 1 }, { sku: "GV-0008", qty: 1 }], discount: 125, courier: 130,
      chain: [
        { to: "CONFIRMED", day: 4, byEmail: SE1 },
        { to: "PACKED", day: 3, byEmail: PCK },
        { to: "HANDED_TO_COURIER", day: 2, byEmail: MGR },
      ],
      payments: [
        { type: "ADVANCE", method: "ROCKET", amount: 1000, day: 4, txn: "DEMO-RK-1008", verified: true },
      ],
    },
    { // 8 — PACKED
      customerPhone: "+971501112233", seEmail: SE2,
      recipientName: "Nazma Khatun", recipientPhoneBd: "01818000008", relation: "Mother",
      address: "Vill: Baniachong", district: "Habiganj", thana: "Baniachong", occasion: "Eid",
      items: [{ pkg: "PKG-001", qty: 1 }], courier: 150,
      chain: [
        { to: "CONFIRMED", day: 3, byEmail: SE2 },
        { to: "PACKED", day: 2, byEmail: PCK },
      ],
      payments: [
        { type: "ADVANCE", method: "BKASH", amount: 3000, day: 3, txn: "DEMO-BK-1009", verified: true },
      ],
    },
    { // 9 — PACKED, cake is per-order
      customerPhone: "+6581234567", seEmail: SE1,
      recipientName: "Liton Das", recipientPhoneBd: "01919000009", relation: "Friend",
      address: "New Market Area", district: "Khulna", thana: "Sonadanga", occasion: "Birthday",
      items: [{ sku: "GV-0001", qty: 2 }, { sku: "GV-0007", qty: 1 }], courier: 100,
      chain: [
        { to: "CONFIRMED", day: 2, byEmail: SE1 },
        { to: "PACKED", day: 1, byEmail: PCK },
      ],
      payments: [
        { type: "ADVANCE", method: "NAGAD", amount: 1200, day: 2, txn: "DEMO-NG-1010" },
      ],
    },
    { // 10 — CONFIRMED (repeat customer of order 1)
      customerPhone: "+966551234567", seEmail: SE1,
      recipientName: "Amina Khatun", recipientPhoneBd: "01711000001", relation: "Mother",
      address: "House 12, Road 3, Dhanmondi", district: "Dhaka", thana: "Dhanmondi", occasion: "Just Because",
      items: [{ pkg: "PKG-003", qty: 1 }], courier: 120,
      chain: [{ to: "CONFIRMED", day: 2, byEmail: SE1 }],
      payments: [
        { type: "ADVANCE", method: "BKASH", amount: 1000, day: 2, txn: "DEMO-BK-1011" },
      ],
    },
    { // 11 — CONFIRMED
      customerPhone: "+97455667788", seEmail: SE2,
      recipientName: "Hasina Begum", recipientPhoneBd: "01711000011", relation: "Relative",
      address: "Vill: Ramganj", district: "Lakshmipur", thana: "Ramganj", occasion: "Other",
      items: [{ sku: "GV-0004", qty: 3 }], discount: 150, courier: 100,
      chain: [{ to: "CONFIRMED", day: 1, byEmail: SE2 }],
      payments: [
        { type: "ADVANCE", method: "NAGAD", amount: 700, day: 1, txn: "DEMO-NG-1012" },
      ],
    },
    { // 12 — CONFIRMED, TL-created, cash in full (office pickup)
      customerPhone: "+96599887766", seEmail: TL,
      recipientName: "Jashim Molla (self pickup)", recipientPhoneBd: "01712000012", relation: "Other",
      address: "Office pickup — Gift Valy, Dhaka", district: "Dhaka", thana: "Gulshan", occasion: "Wedding",
      items: [{ sku: "GV-0002", qty: 1 }, { sku: "GV-0003", qty: 1 }],
      chain: [{ to: "CONFIRMED", day: 0, byEmail: TL }],
      payments: [
        { type: "ADVANCE", method: "CASH", amount: 2600, day: 0 },
      ],
      codOverride: 0,
    },
    { // 13 — ON_HOLD: zero advance (SPEC §1.3 — no CONFIRMED without advance)
      customerPhone: "+447700900123", seEmail: SE2,
      recipientName: "Monira Begum", recipientPhoneBd: "01813000013", relation: "Wife",
      address: "Housing Estate B-14", district: "Bogura", thana: "Bogura Sadar", occasion: "Anniversary",
      items: [{ sku: "GV-0006", qty: 1 }], courier: 120,
      chain: [{ to: "ON_HOLD", day: 1, byEmail: SE2, note: "No advance payment — held until advance is recorded" }],
      payments: [],
    },
    { // 14 — CANCELLED with refund of the advance
      customerPhone: "+14165550123", seEmail: SE1,
      recipientName: "Parvin Akter", recipientPhoneBd: "01914000014", relation: "Daughter",
      address: "Lake Road 7", district: "Barishal", thana: "Barishal Sadar", occasion: "Graduation",
      items: [{ sku: "GV-0008", qty: 2 }], courier: 100,
      chain: [
        { to: "CONFIRMED", day: 3, byEmail: SE1 },
        { to: "CANCELLED", day: 2, byEmail: ADM, note: "Customer cancelled — recipient travelling" },
      ],
      payments: [
        { type: "ADVANCE", method: "BKASH", amount: 500, day: 3, txn: "DEMO-BK-1013", verified: true },
        { type: "REFUND", method: "BKASH", amount: 500, day: 2, txn: "DEMO-BK-1014" },
      ],
      cancelReason: "Customer cancelled — recipient travelling",
      codOverride: 0,
    },
    { // 15 — RETURNED (refund pending)
      customerPhone: "+60111222333", seEmail: SE2,
      recipientName: "Sumon Mia", recipientPhoneBd: "01815000015", relation: "Sibling",
      address: "Vill: Kaliganj Bazar", district: "Gazipur", thana: "Kaliganj", occasion: "Birthday",
      items: [{ pkg: "PKG-002", qty: 1 }], courier: 100,
      chain: [
        { to: "CONFIRMED", day: 10, byEmail: SE2 },
        { to: "PACKED", day: 9, byEmail: PCK },
        { to: "HANDED_TO_COURIER", day: 8, byEmail: MGR },
        { to: "IN_TRANSIT", day: 7, byEmail: MGR },
        { to: "RETURNED", day: 5, byEmail: MGR, note: "Recipient unreachable — parcel returned" },
      ],
      payments: [
        { type: "ADVANCE", method: "NAGAD", amount: 900, day: 10, txn: "DEMO-NG-1015", verified: true },
      ],
      codOverride: 0,
    },
  ];

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const accountsId = userIdByEmail.get("accounts@giftvaly.com")!;
  const adminId = userIdByEmail.get(ADM)!;
  const mgrId = userIdByEmail.get(MGR)!;

  // Which ShipmentStatus an order's current status implies (SPEC §7). Orders that
  // never reached handover return null (no shipment). COMPLETED shows as DELIVERED.
  const courierStageOf = (s: OrderStatus): ShipmentStatus | null => {
    if (s === "HANDED_TO_COURIER" || s === "IN_TRANSIT" || s === "DELIVERED" || s === "RETURNED") {
      return s;
    }
    if (s === "COMPLETED") return "DELIVERED";
    return null;
  };
  // Auto-created "Courier Charge" category (§9.1) for seeded COD-fee expenses.
  const courierCategory = await prisma.expenseCategory.upsert({
    where: { name: "Courier Charge" },
    update: {},
    create: { name: "Courier Charge", costType: "VARIABLE" },
  });

  // Opening stock (SPEC §14 "current stock = SUM(movements)"): one ADJUST_PLUS
  // baseline per tracked product so the ledger reconciles with the seeded
  // stock_qty cache. Perishables (non-stock-tracked) never hit the ledger.
  const trackedProducts = demoProducts.filter((p) => p.isStockTracked && p.stockQty > 0);
  await prisma.stockMovement.createMany({
    data: trackedProducts.map((p) => ({
      productId: productIdBySku.get(p.sku)!,
      type: "ADJUST_PLUS" as const,
      qty: p.stockQty,
      reason: "Opening stock (seed baseline)",
      at: daysAgo(40, 9),
      createdBy: adminId,
    })),
  });

  // Demo purchases (SPEC §6.3 supplier credit) — a paid, a partial, and an
  // overdue-due bill so the purchase history, the due list, and the dashboard
  // alert all have data. Each restocks on top of the opening baseline at the
  // product's current avg cost (so the weighted average is unchanged), and the
  // cost is expensed only for the cash actually paid. Purchases/expenses were
  // wiped above, so this is idempotent.
  const purchaseCategory = await prisma.expenseCategory.upsert({
    where: { name: "Product Purchase" },
    update: {},
    create: { name: "Product Purchase", costType: "VARIABLE" },
  });
  const cashWallet = walletIdByType.get("CASH")!;
  const demoPurchases: {
    supplier: string;
    date: Date;
    sku: string;
    qty: number;
    paid: number; // cash paid at entry
    walletId: number | null;
    dueDate: Date | null;
  }[] = [
    // Fully paid from Cash — expenses the full total on the purchase date.
    { supplier: "Dhaka Wholesale Ltd", date: daysAgo(15), sku: "GV-0004", qty: 20, paid: round2(20 * avgCostBySku.get("GV-0004")!), walletId: cashWallet, dueDate: null },
    // Partially paid — rest due in 5 days; only the paid part is an expense now.
    { supplier: "Chittagong Traders", date: daysAgo(10), sku: "GV-0006", qty: 10, paid: 6000, walletId: cashWallet, dueDate: daysAgo(-5) },
    // Bought on credit, nothing paid, already overdue — no expense until paid.
    { supplier: "Bogura Suppliers", date: daysAgo(20), sku: "GV-0003", qty: 15, paid: 0, walletId: null, dueDate: daysAgo(3) },
  ];
  for (const dp of demoPurchases) {
    const productId = productIdBySku.get(dp.sku)!;
    const unitCost = avgCostBySku.get(dp.sku)!;
    const total = round2(dp.qty * unitCost);
    const paid = round2(Math.min(dp.paid, total));
    const status = paid >= total ? "PAID" : paid <= 0 ? "DUE" : "PARTIAL";
    const purchase = await prisma.purchase.create({
      data: {
        supplierName: dp.supplier,
        // @db.Date columns — pin to the Dhaka calendar day
        purchaseDate: dhakaDateBound(dp.date),
        totalAmount: total,
        paymentStatus: status,
        dueDate: status === "PAID" || !dp.dueDate ? null : dhakaDateBound(dp.dueDate),
        createdBy: accountsId,
        updatedBy: accountsId,
        items: { create: [{ productId, qty: dp.qty, unitCost, lineTotal: total }] },
      },
    });
    // Restock at the current avg cost — weighted average is unchanged.
    await prisma.stockMovement.create({
      data: {
        productId,
        type: "IN_PURCHASE",
        qty: dp.qty,
        refTable: "purchases",
        refId: purchase.id,
        at: dp.date,
        createdBy: accountsId,
      },
    });
    await prisma.product.update({
      where: { id: productId },
      data: { stockQty: { increment: dp.qty } },
    });
    if (paid > 0) {
      await prisma.expense.create({
        data: {
          expenseDate: dhakaDateBound(dp.date), // @db.Date
          categoryId: purchaseCategory.id,
          amount: paid,
          walletId: dp.walletId,
          notes: `Purchase from ${dp.supplier}`,
          refTable: "purchases",
          refId: purchase.id,
          createdBy: accountsId,
          updatedBy: accountsId,
        },
      });
    }
  }

  // BOM-expanded stock requirement per tracked product for an order's lines
  // (PRODUCT lines count themselves; PACKAGE lines expand their BOM).
  const isTrackedBySku = new Map(demoProducts.map((p) => [p.sku, p.isStockTracked]));
  const pkgItemsByCode = new Map(demoPackages.map((pkg) => [pkg.code, pkg.items]));
  const trackedRequirements = (items: DemoLine[]) => {
    const need = new Map<number, number>();
    const add = (sku: string, qty: number) => {
      if (!isTrackedBySku.get(sku)) return;
      const id = productIdBySku.get(sku)!;
      need.set(id, (need.get(id) ?? 0) + qty);
    };
    for (const it of items) {
      if (it.sku) add(it.sku, it.qty);
      else for (const b of pkgItemsByCode.get(it.pkg!)!) add(b.sku, it.qty * b.qty);
    }
    return need;
  };

  for (const [idx, d] of demoOrders.entries()) {
    const seId = userIdByEmail.get(d.seEmail)!;
    const se = await prisma.user.findUniqueOrThrow({
      where: { id: seId },
      select: { teamId: true },
    });
    const createdAt = daysAgo(d.chain[0].day, 10);
    const status = d.chain[d.chain.length - 1].to;
    const reachedPacked = d.chain.some((s) => s.to === "PACKED");

    const lines = d.items.map((it) => {
      const unitPrice =
        it.unitPrice ??
        (it.sku ? priceBySku.get(it.sku)! : pkgPriceByCode.get(it.pkg!)!);
      // unit_cost_snapshot freezes at PACKED (integrity rule 4)
      const unitCost = reachedPacked
        ? it.sku
          ? avgCostBySku.get(it.sku)!
          : pkgCostByCode.get(it.pkg!)!
        : null;
      return {
        itemType: (it.sku ? "PRODUCT" : "PACKAGE") as "PRODUCT" | "PACKAGE",
        productId: it.sku ? productIdBySku.get(it.sku)! : null,
        packageId: it.pkg ? packageIdByCode.get(it.pkg)! : null,
        qty: it.qty,
        unitPrice,
        unitCostSnapshot: unitCost,
        lineTotal: round2(it.qty * unitPrice),
      };
    });
    const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    const discount = d.discount ?? 0;
    const courier = d.courier ?? 0;
    const total = round2(subtotal - discount + courier);
    const paid = d.payments.reduce(
      (s, p) => s + (p.type === "REFUND" ? -p.amount : p.amount),
      0
    );
    const due = round2(total - paid);
    const advance = d.payments.find((p) => p.type === "ADVANCE")?.amount ?? 0;
    const cod = d.codOverride ?? Math.max(round2(total - advance), 0);

    await prisma.$transaction(async (tx) => {
      const orderNo = await nextOrderNoFor(createdAt);
      const order = await tx.order.create({
        data: {
          orderNo,
          customerId: customerIdByPhone.get(d.customerPhone)!,
          recipientName: d.recipientName,
          recipientPhoneBd: d.recipientPhoneBd,
          recipientRelation: d.relation,
          deliveryAddress: d.address,
          district: d.district,
          thana: d.thana,
          occasion: d.occasion,
          subtotal,
          discount,
          courierChargeCustomer: courier,
          totalAmount: total,
          advanceAmount: advance,
          dueAmount: due,
          codAmount: cod,
          status,
          cancelReason: d.cancelReason ?? null,
          salesExecutiveId: seId,
          teamId: se.teamId,
          createdAt,
          createdBy: seId,
          updatedBy: seId,
        },
      });
      await tx.orderItem.createMany({
        data: lines.map((l) => ({ orderId: order.id, ...l })),
      });
      await tx.orderStatusHistory.createMany({
        data: d.chain.map((step, i) => ({
          orderId: order.id,
          fromStatus: i === 0 ? null : d.chain[i - 1].to,
          toStatus: step.to,
          byUser: userIdByEmail.get(step.byEmail)!,
          at: daysAgo(step.day, 10 + Math.min(i, 8)),
          note: step.note ?? null,
        })),
      });
      if (d.payments.length > 0) {
        await tx.payment.createMany({
          data: d.payments.map((p) => ({
            orderId: order.id,
            paymentDate: daysAgo(p.day, 11),
            type: p.type,
            method: p.method,
            amount: p.amount,
            walletId: walletIdByMethod.get(p.method) ?? null, // receiving account (§8)
            transactionId: p.txn ?? null,
            senderNumber: p.sender ?? null,
            isVerified: p.verified ?? false,
            verifiedBy: p.verified ? accountsId : null,
            createdBy: seId,
            updatedBy: seId,
          })),
        });
      }

      // SPEC §1.3: CONFIRMED orders hold a live reservation. PACKED-and-beyond
      // orders already deducted stock historically — the seeded stock_qty is
      // the current on-hand, so they need no ledger rows here. Terminal states
      // (cancelled/returned) hold nothing.
      if (status === "CONFIRMED") {
        const need = trackedRequirements(d.items);
        if (need.size > 0) {
          await tx.stockMovement.createMany({
            data: [...need].map(([productId, qty]) => ({
              productId,
              type: "RESERVE" as const,
              qty: -qty, // RESERVE is signed negative (reserved_qty goes up)
              refTable: "orders",
              refId: order.id,
              at: createdAt,
              createdBy: seId,
            })),
          });
          for (const [productId, qty] of need) {
            await tx.product.update({
              where: { id: productId },
              data: { reservedQty: { increment: qty } },
            });
          }
        }
      }

      // SPEC §7 — shipment for any order that reached courier handover. Status
      // mirrors the order's courier stage; COD-received orders (a COD_COURIER
      // payment exists) also carry the auto COD-fee expense, and a RETURNED
      // shipment stays unapproved so it shows in the returns queue.
      const shipmentStatus = courierStageOf(status);
      if (shipmentStatus) {
        const courierName = demoCouriers[idx % demoCouriers.length].name;
        const courierId = courierIdByName.get(courierName)!;
        const feePercent = courierFeeByName.get(courierName)!;
        const handoverDay =
          d.chain.find((s) => s.to === "HANDED_TO_COURIER")?.day ??
          d.chain[d.chain.length - 1].day;
        const deliveredStep = d.chain.find((s) => s.to === "DELIVERED");
        const returnedStep = d.chain.find((s) => s.to === "RETURNED");
        const codPaymentDay = d.payments.find((p) => p.type === "COD_COURIER")?.day;
        const codReceived = codPaymentDay !== undefined;

        const shipment = await tx.shipment.create({
          data: {
            orderId: order.id,
            courierId,
            trackingNo: `TRK-${1000 + idx}`,
            // @db.Date columns — pin to the Dhaka calendar day
            handoverDate: dhakaDateBound(daysAgo(handoverDay, 9)),
            codAmount: cod,
            expectedDelivery: dhakaDateBound(daysAgo(Math.max(handoverDay - 2, 0), 9)),
            status: shipmentStatus,
            deliveredAt: deliveredStep ? daysAgo(deliveredStep.day, 14) : null,
            returnedAt: returnedStep ? daysAgo(returnedStep.day, 14) : null,
            courierCostActual: shipmentStatus === "DELIVERED" ? (d.courier ?? 0) : null,
            codReceived,
            codReceivedAt: codReceived ? daysAgo(codPaymentDay!, 12) : null,
            createdBy: mgrId,
            updatedBy: mgrId,
          },
        });

        const codFee = round2((cod * feePercent) / 100);
        if (codReceived && codFee > 0) {
          const feeExpense = await tx.expense.create({
            data: {
              expenseDate: dhakaDateBound(daysAgo(codPaymentDay!, 12)), // @db.Date
              categoryId: courierCategory.id,
              amount: codFee,
              walletId: bankWalletId, // fee netted from the COD settled to the bank (§9.3)
              notes: `COD fee — ${courierName} — ${order.orderNo}`,
              refTable: "shipments",
              refId: shipment.id,
              createdBy: accountsId,
              updatedBy: accountsId,
            },
          });
          await tx.shipment.update({
            where: { id: shipment.id },
            data: { codFeeExpenseId: feeExpense.id },
          });
        }
      }
    });
  }

  // ============ 9b. Demo leads (SPEC §3) ============
  // Leads is a fresh table — fully regenerated each seed. Deleting a lead nulls
  // any order.lead_id via onDelete: SetNull, so this is safe for converted ones.
  await prisma.leadDailyCount.deleteMany({});
  await prisma.lead.deleteMany({});

  const sanjoyId = userIdByEmail.get("sanjoy@giftvaly.com")!;
  const parthoId = userIdByEmail.get("partho@giftvaly.com")!;
  const productNameBySku = new Map(demoProducts.map((p) => [p.sku, p.name]));
  const packageNameByCode = new Map(demoPackages.map((p) => [p.code, p.name]));
  type Pick = { sku?: string; pkg?: string };
  const interestedOf = (picks: Pick[]) =>
    picks.map((pk) =>
      pk.sku
        ? { itemType: "PRODUCT", id: productIdBySku.get(pk.sku)!, name: productNameBySku.get(pk.sku)! }
        : { itemType: "PACKAGE", id: packageIdByCode.get(pk.pkg!)!, name: packageNameByCode.get(pk.pkg!)! }
    );
  // Follow-up timestamps anchored to the Asia/Dhaka calendar so "today's
  // follow-ups" and "overdue" land in the right buckets regardless of server TZ.
  const dhakaDateStr = (offsetDays: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(
      new Date(Date.now() + offsetDays * 86_400_000)
    );
  const followUpAt = (offsetDays: number, hour: number) =>
    new Date(`${dhakaDateStr(offsetDays)}T${String(hour).padStart(2, "0")}:00:00+06:00`);
  // @db.Date value for the Dhaka day n days ago — UTC-midnight, NOT a +06
  // instant (which Prisma would truncate to the previous UTC day).
  const leadDateOf = (n: number) => new Date(`${dhakaDateStr(-n)}T00:00:00.000Z`);

  const demoLeads = [
    { phone: "+9665500010001", name: "Imran Chowdhury", country: "KSA", se: sanjoyId,
      source: "FACEBOOK_AD" as const, campaign: "Eid FB Ad", status: "NEW" as const,
      leadN: 0, follow: null, interested: [{ pkg: "PKG-001" }], notes: "Asked about Eid delivery" },
    { phone: "+9715500010002", name: "Shirin Akhter", country: "UAE", se: sanjoyId,
      source: "MESSENGER" as const, campaign: null, status: "CONTACTED" as const,
      leadN: 1, follow: followUpAt(0, 16), interested: [{ sku: "GV-0005" }], notes: "Wants Jamdani saree, will confirm today" },
    { phone: "+9745500010003", name: "R1 Nabil", country: "Qatar", se: sanjoyId,
      source: "WHATSAPP" as const, campaign: "Retargeting", status: "NEGOTIATING" as const,
      leadN: 3, follow: followUpAt(-2, 12), interested: [{ pkg: "PKG-003" }], notes: "Negotiating on price — OVERDUE follow-up" },
    { phone: "+9665500010004", name: "Tanvir Hasan", country: "KSA", se: sanjoyId,
      source: "FACEBOOK_AD" as const, campaign: "Boishakh Boost", status: "FOLLOW_UP" as const,
      leadN: 2, follow: followUpAt(0, 11), interested: [{ sku: "GV-0003" }, { sku: "GV-0009" }], notes: "Follow up this morning" },
    { phone: "+601155000105", name: "Rahela Khatun", country: "Malaysia", se: sanjoyId,
      source: "INSTAGRAM" as const, campaign: null, status: "LOST" as const, lostReason: "PRICE" as const,
      leadN: 5, follow: null, interested: [{ pkg: "PKG-002" }], notes: "Too expensive" },
    { phone: "+9665500010006", name: "Sohel Rana", country: "KSA", se: parthoId,
      source: "FACEBOOK_AD" as const, campaign: "New Reels", status: "NEW" as const,
      leadN: 0, follow: null, interested: [{ sku: "GV-0006" }], notes: null },
    { phone: "+9715500010007", name: "Farhana Yeasmin", country: "UAE", se: parthoId,
      source: "REFERRAL" as const, campaign: null, status: "CONTACTED" as const,
      leadN: 2, follow: followUpAt(-1, 14), interested: [{ sku: "GV-0002" }], notes: "Referred by a past customer — OVERDUE" },
    { phone: "+974550001008", name: "Kamrul Islam", country: "Qatar", se: parthoId,
      source: "WHATSAPP" as const, campaign: "Eid FB Ad", status: "NEGOTIATING" as const,
      leadN: 1, follow: followUpAt(0, 18), interested: [{ pkg: "PKG-001" }], notes: "Wants a discount" },
    { phone: "+966550001009", name: "Nadia Sultana", country: "KSA", se: parthoId,
      source: "MESSENGER" as const, campaign: "Retargeting", status: "LOST" as const, lostReason: "NO_RESPONSE" as const,
      leadN: 4, follow: null, interested: [], notes: "Went silent" },
    { phone: "+971550001010", name: "Repeat Buyer", country: "UAE", se: parthoId,
      source: "REPEAT_CUSTOMER" as const, campaign: null, status: "FOLLOW_UP" as const,
      leadN: 1, follow: followUpAt(1, 10), interested: [{ sku: "GV-0004" }], notes: "Regular — reminder tomorrow" },
  ];

  for (const l of demoLeads) {
    await prisma.lead.create({
      data: {
        leadDate: leadDateOf(l.leadN),
        source: l.source,
        campaignName: l.campaign,
        customerName: l.name,
        country: l.country,
        whatsappNumber: l.phone,
        interestedIn: interestedOf(l.interested) as unknown as Prisma.InputJsonValue,
        status: l.status,
        followUpAt: l.follow,
        lostReason: "lostReason" in l ? l.lostReason : null,
        notes: l.notes,
        assignedTo: l.se,
        teamId: team.id,
        createdAt: leadDateOf(l.leadN),
        createdBy: l.se,
        updatedBy: l.se,
      },
    });
  }

  // A few converted leads linked to existing demo orders (§3.2 auto-convert),
  // so the R2 conversion % and the lead→order link have real data.
  const convOrders = await prisma.order.findMany({
    where: { customerId: { in: demoCustomerIds }, leadId: null },
    orderBy: { createdAt: "asc" },
    take: 3,
    include: { customer: true },
  });
  const convSources = ["FACEBOOK_AD", "MESSENGER", "WHATSAPP"] as const;
  const convCampaigns = ["Eid FB Ad", "Boishakh Boost", "New Reels"];
  for (const [i, o] of convOrders.entries()) {
    const lead = await prisma.lead.create({
      data: {
        leadDate: dhakaDateBound(o.createdAt), // @db.Date — the order's Dhaka day
        source: convSources[i % convSources.length],
        campaignName: convCampaigns[i % convCampaigns.length],
        customerName: o.customer.name,
        country: o.customer.country,
        whatsappNumber: o.customer.phoneForeign,
        interestedIn: [] as unknown as Prisma.InputJsonValue,
        status: "CONVERTED",
        assignedTo: o.salesExecutiveId,
        teamId: o.teamId,
        createdAt: o.createdAt,
        createdBy: o.salesExecutiveId,
        updatedBy: o.salesExecutiveId,
      },
    });
    await prisma.order.update({ where: { id: o.id }, data: { leadId: lead.id } });
  }

  // Bulk daily counts (§3.1) — a few days of per-source totals per SE.
  const dailyCountRows: {
    date: Date; userId: number; source: (typeof convSources)[number] | "INSTAGRAM"; campaignName: string | null; count: number;
  }[] = [];
  for (const [se, base] of [[sanjoyId, 12], [parthoId, 9]] as const) {
    for (let day = 1; day <= 4; day++) {
      dailyCountRows.push({
        date: leadDateOf(day),
        userId: se,
        source: "FACEBOOK_AD",
        campaignName: "Eid FB Ad",
        count: base + day,
      });
      dailyCountRows.push({
        date: leadDateOf(day),
        userId: se,
        source: "INSTAGRAM",
        campaignName: null,
        count: Math.max(0, base - day),
      });
    }
  }
  await prisma.leadDailyCount.createMany({
    data: dailyCountRows.map((r) => ({ ...r, createdBy: r.userId, updatedBy: r.userId })),
  });

  // Demo manual expenses (SPEC §9.1) so the R8 report + ad-cost trend have data.
  // Ad cost is a near-daily entry over the last ~5 weeks (a few zero-spend days),
  // plus a handful of fixed/variable costs landing in the current month.
  const bkashWalletId = walletIdByType.get("BKASH")!;
  const cashWalletId = walletIdByType.get("CASH")!;
  const adCostCategoryId = expenseCategoryIdByName.get(AD_COST_CATEGORY)!;
  const adCampaigns = ["Eid FB Ad", "Boishakh Boost", "Retargeting", "New Reels"];
  const demoExpenses: {
    expenseDate: Date;
    categoryId: number;
    amount: number;
    walletId: number | null;
    campaignName: string | null;
    notes: string | null;
  }[] = [];

  for (let day = 0; day < 35; day++) {
    if (day % 8 === 5) continue; // occasional zero-spend day (visible in the chart)
    const amount = round2(900 + (day % 5) * 420 + (day % 3) * 260);
    demoExpenses.push({
      expenseDate: dhakaDateBound(daysAgo(day, 11)), // @db.Date
      categoryId: adCostCategoryId,
      amount,
      walletId: bkashWalletId,
      campaignName: adCampaigns[day % adCampaigns.length],
      notes: null,
    });
  }

  const fixedAndOther: {
    name: string;
    amount: number;
    day: number;
    walletId: number | null;
    notes: string | null;
  }[] = [
    { name: "Salary", amount: 45000, day: 5, walletId: bankWalletId, notes: "June salaries" },
    { name: "Rent", amount: 18000, day: 4, walletId: bankWalletId, notes: "Office rent" },
    { name: "Utilities", amount: 4200, day: 3, walletId: cashWalletId, notes: "Electricity + internet" },
    { name: "Packaging Materials", amount: 6500, day: 6, walletId: cashWalletId, notes: "Boxes + wrap" },
    { name: "Office", amount: 2300, day: 2, walletId: cashWalletId, notes: "Stationery" },
    { name: "Other", amount: 1500, day: 1, walletId: cashWalletId, notes: "Misc" },
  ];
  for (const f of fixedAndOther) {
    const categoryId = expenseCategoryIdByName.get(f.name);
    if (!categoryId) continue;
    demoExpenses.push({
      expenseDate: dhakaDateBound(daysAgo(f.day, 12)), // @db.Date
      categoryId,
      amount: f.amount,
      walletId: f.walletId,
      campaignName: null,
      notes: f.notes,
    });
  }

  await prisma.expense.createMany({
    data: demoExpenses.map((e) => ({
      ...e,
      createdBy: accountsId,
      updatedBy: accountsId,
    })),
  });

  // 10. Targets & Rewards (SPEC §10). Reward rules, the onboarding-grace setting
  // and demo targets for the current Asia/Dhaka month (incl. a confidential TL
  // target). Rewards themselves are left uncomputed — run the month-close from
  // /targets/manage to see the flow.
  const rewardRulesSeed = [
    { name: "Target hit (100%)", type: "ACHIEVEMENT" as const, minAchievementPercent: 100, rewardAmount: 3000 },
    { name: "Overachiever (120%)", type: "ACHIEVEMENT" as const, minAchievementPercent: 120, rewardAmount: 6000 },
    { name: "Top seller of month", type: "TOP_SELLER" as const, minAchievementPercent: null, rewardAmount: 5000 },
  ];
  for (const r of rewardRulesSeed) {
    await prisma.rewardRule.upsert({
      where: { name: r.name },
      update: { type: r.type, minAchievementPercent: r.minAchievementPercent, rewardAmount: r.rewardAmount, isActive: true },
      create: { ...r, createdBy: adminId, updatedBy: adminId },
    });
  }
  await prisma.setting.upsert({
    where: { key: "onboarding_exclude_days" },
    update: {},
    create: { key: "onboarding_exclude_days", value: 30 },
  });

  const seedMonthKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const seedMonth = new Date(`${seedMonthKey}-01T00:00:00.000Z`);
  const sakibId = userIdByEmail.get(TL)!;

  const userTargets = [
    { userId: sanjoyId, targetOrders: 20, targetAmount: 300000, isConfidential: false },
    { userId: parthoId, targetOrders: 15, targetAmount: 250000, isConfidential: false },
    // Confidential TL target — visible only to Admin + Sakib (§10).
    { userId: sakibId, targetOrders: 10, targetAmount: 200000, isConfidential: true },
  ];
  for (const t of userTargets) {
    await prisma.target.upsert({
      where: { month_userId: { month: seedMonth, userId: t.userId } },
      update: { targetOrders: t.targetOrders, targetAmount: t.targetAmount, isConfidential: t.isConfidential },
      create: {
        month: seedMonth, scope: "USER", userId: t.userId,
        targetOrders: t.targetOrders, targetAmount: t.targetAmount, isConfidential: t.isConfidential,
        createdBy: adminId, updatedBy: adminId,
      },
    });
  }
  await prisma.target.upsert({
    where: { month_teamId: { month: seedMonth, teamId: team.id } },
    update: { targetOrders: 45, targetAmount: 700000 },
    create: {
      month: seedMonth, scope: "TEAM", teamId: team.id,
      targetOrders: 45, targetAmount: 700000,
      createdBy: adminId, updatedBy: adminId,
    },
  });

  const orderCount = await prisma.order.count();
  const leadCount = await prisma.lead.count();
  const convertedLeadCount = await prisma.lead.count({ where: { status: "CONVERTED" } });
  const dailyCountTotal = await prisma.leadDailyCount.count();
  const paymentCount = await prisma.payment.count();
  const movementCount = await prisma.stockMovement.count();
  const shipmentCount = await prisma.shipment.count();
  const expenseCategoryCount = await prisma.expenseCategory.count();
  const expenseCount = await prisma.expense.count();

  console.log("Seed complete:");
  console.log(`  ${PERMISSION_DEFS.length} permissions, ${ROLE_NAMES.length} roles (matrix applied)`);
  console.log("  Team: Team Alpha");
  console.log(`  Catalog: ${categoryNames.length} categories, ${demoProducts.length} products, ${demoPackages.length} packages`);
  console.log(`  Demo data: ${demoCustomers.length} customers, ${demoOrders.length} demo orders (${orderCount} total), ${paymentCount} payments`);
  console.log(`  Leads: ${leadCount} leads (${convertedLeadCount} converted), ${dailyCountTotal} daily-count rows`);
  console.log(`  Stock: ${movementCount} movements (opening balances + confirmed-order reservations)`);
  console.log(`  Courier: ${demoCouriers.length} couriers, ${shipmentCount} shipments (incl. delivered, in-transit, COD-pending, returned)`);
  console.log(`  Money: ${demoWallets.length} wallets (bKash/Nagad/Rocket/Bank/Cash), payments attributed by method`);
  console.log(`  Expenses: ${expenseCategoryCount} categories (fixed/variable), ${expenseCount} expenses (ad-cost trend + fixed costs + auto COD fees)`);
  console.log(`  Targets:  ${rewardRulesSeed.length} reward rules, 3 user + 1 team target for ${seedMonthKey}; onboarding grace = 30 days`);
  console.log("  Admin:    mh.neshad39@gmail.com / Admin@GV2026");
  console.log("  Manager:  manager@giftvaly.com  / Manager@GV2026");
  console.log("  TL:       sakib@giftvaly.com    / Team@GV2026");
  console.log("  SE:       sanjoy@giftvaly.com   / Sales@GV2026");
  console.log("  SE:       partho@giftvaly.com   / Sales@GV2026");
  console.log("  Packing:  packing@giftvaly.com  / Pack@GV2026");
  console.log("  Accounts: accounts@giftvaly.com / Acc@GV2026");
  console.log("  Setting: order_edit_window_minutes = 30");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
