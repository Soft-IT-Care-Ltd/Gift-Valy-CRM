// Seed: 6 roles + permission matrix (SPEC §2), 1 Admin, 2 demo Sales Executives,
// demo catalog (8 categories, 10 products, 3 packages — SPEC §6.1/§6.2).
// Idempotent — safe to re-run (upserts everywhere; re-running resets demo
// catalog prices/stock and package BOMs to these values).
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  PERMISSION_DEFS,
  ROLE_MATRIX,
  ROLE_NAMES,
} from "../lib/permissions";

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
  ];

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
        joinedAt: new Date(),
      },
    });
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
    const data = { ...fields, categoryId: catIdByName.get(category)! };
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
  for (const pkg of demoPackages) {
    const { code, items, ...fields } = pkg;
    const saved = await prisma.package.upsert({
      where: { code },
      update: fields,
      create: { code, ...fields },
    });
    await prisma.packageItem.deleteMany({ where: { packageId: saved.id } });
    await prisma.packageItem.createMany({
      data: items.map((it) => ({
        packageId: saved.id,
        productId: productIdBySku.get(it.sku)!,
        qty: it.qty,
      })),
    });
  }

  console.log("Seed complete:");
  console.log(`  ${PERMISSION_DEFS.length} permissions, ${ROLE_NAMES.length} roles (matrix applied)`);
  console.log("  Team: Team Alpha");
  console.log(`  Catalog: ${categoryNames.length} categories, ${demoProducts.length} products, ${demoPackages.length} packages`);
  console.log("  Admin:  mh.neshad39@gmail.com / Admin@GV2026");
  console.log("  TL:     sakib@giftvaly.com    / Team@GV2026");
  console.log("  SE:     sanjoy@giftvaly.com   / Sales@GV2026");
  console.log("  SE:     partho@giftvaly.com   / Sales@GV2026");
  console.log("  Setting: order_edit_window_minutes = 30");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
