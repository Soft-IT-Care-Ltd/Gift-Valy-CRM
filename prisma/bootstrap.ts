// FUNNEL_LINER.md GV-12 — the production (and staging) bootstrap, in place of
// the demo seed (CLAUDE.md rule 6). Run through `npm run db:bootstrap`
// (scripts/db-bootstrap.sh), which asks for the first Admin on the terminal.
//
// 1. The base the app needs, creating only what is missing:
//    - every permission (lib/permissions.ts);
//    - each role that doesn't exist yet, with its ROLE_MATRIX permissions —
//      an existing role is left alone, so an Admin's later edits survive;
//    - default settings (order edit window, attendance office hours,
//      onboarding exclusion);
//    - the standard expense categories, plus "Courier Charge" and "Product
//      Purchase" which the courier and purchase modules post to;
//    - the Steadfast courier row (1% COD fee, no zone rates — the Admin sets
//      those on the Courier page).
// 2. The first Admin — only while no active Admin exists. Its details come
//    from BOOTSTRAP_ADMIN_* environment variables of this one process (set by
//    scripts/db-bootstrap.sh from what was typed, never written anywhere).
//    must-change-password is on.
//
// Nothing else: no team, users, wallets, products, customers, orders, targets,
// rewards or currency rates — and never order_sequences. Run twice, it does
// nothing the second time.
//
// Exit codes: 0 done (or nothing to do) · 3 the base is in place but there is
// no Admin and no BOOTSTRAP_ADMIN_* were given (the shell script then asks).
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { PERMISSION_DEFS, ROLE_MATRIX, ROLE_NAMES } from "../lib/permissions";
import { SEED_EXPENSE_CATEGORIES } from "../lib/expense-constants";
import { COURIER_EXPENSE_CATEGORY } from "../lib/courier-constants";
import { STEADFAST_COURIER_NAME } from "../lib/steadfast-constants";
import {
  ATTENDANCE_SETTINGS_KEY,
  DEFAULT_ATTENDANCE_SETTINGS,
  attendanceSettingsToJson,
} from "../lib/attendance-constants";
import { dhakaDateBound } from "../lib/order-constants";
import { normalizeUserPhone } from "../lib/user-phone";

export const NEEDS_ADMIN_EXIT = 3;
const MIN_PASSWORD = 8; // the app's own minimum (app/api/users, change-password)

const prisma = new PrismaClient();

const adminSchema = z.object({
  name: z.string().trim().min(1, "A name is needed"),
  email: z.string().trim().toLowerCase().email("Not an email address"),
  phone: z.string().transform((raw, ctx) => {
    const phone = normalizeUserPhone(raw);
    if (!phone) ctx.addIssue({ code: "custom", message: "Not a phone number (01XXXXXXXXX)" });
    return phone ?? "";
  }),
  password: z.string().min(MIN_PASSWORD, `The password needs at least ${MIN_PASSWORD} characters`),
});

async function base() {
  const created: string[] = [];
  await prisma.$transaction(async (tx) => {
    const perms = await tx.permission.createMany({
      data: PERMISSION_DEFS.map((d) => ({ key: d.key })),
      skipDuplicates: true,
    });
    if (perms.count) created.push(`${perms.count} permission(s)`);
    const permIdByKey = new Map(
      (await tx.permission.findMany()).map((p) => [p.key, p.id])
    );

    for (const name of ROLE_NAMES) {
      if (await tx.role.findUnique({ where: { name } })) continue;
      const role = await tx.role.create({ data: { name } });
      await tx.rolePermission.createMany({
        data: ROLE_MATRIX[name].map((key) => {
          const permissionId = permIdByKey.get(key);
          if (!permissionId) throw new Error(`Unknown permission key: ${key}`);
          return { roleId: role.id, permissionId };
        }),
      });
      created.push(`role ${name}`);
    }

    const settings = await tx.setting.createMany({
      data: [
        { key: "order_edit_window_minutes", value: 30 },
        { key: ATTENDANCE_SETTINGS_KEY, value: attendanceSettingsToJson(DEFAULT_ATTENDANCE_SETTINGS) },
        { key: "onboarding_exclude_days", value: 30 },
      ],
      skipDuplicates: true,
    });
    if (settings.count) created.push(`${settings.count} setting(s)`);

    const categories = await tx.expenseCategory.createMany({
      data: [
        ...SEED_EXPENSE_CATEGORIES,
        { name: COURIER_EXPENSE_CATEGORY, costType: "VARIABLE" as const },
        { name: "Product Purchase", costType: "VARIABLE" as const },
      ],
      skipDuplicates: true,
    });
    if (categories.count) created.push(`${categories.count} expense categor(y/ies)`);

    if (!(await tx.courier.findUnique({ where: { name: STEADFAST_COURIER_NAME } }))) {
      await tx.courier.create({
        data: { name: STEADFAST_COURIER_NAME, contact: "16460", codFeePercent: 1.0 },
      });
      created.push("the Steadfast courier");
    }
  });
  console.log(created.length ? `Created: ${created.join(", ")}.` : "Roles, permissions and defaults: already in place.");
}

async function firstAdmin(): Promise<number> {
  const existing = await prisma.user.findFirst({
    where: { isActive: true, role: { name: "Admin" } },
    select: { email: true },
  });
  if (existing) {
    console.log(`An Admin already exists (${existing.email}) — nothing more to do. More staff: Admin → Users.`);
    return 0;
  }

  const env = process.env;
  if (!env.BOOTSTRAP_ADMIN_EMAIL) {
    console.log("No Admin yet. Run `npm run db:bootstrap` from a terminal (ssh -t …) to create the first one.");
    return NEEDS_ADMIN_EXIT;
  }
  const parsed = adminSchema.safeParse({
    name: env.BOOTSTRAP_ADMIN_NAME ?? "",
    email: env.BOOTSTRAP_ADMIN_EMAIL,
    phone: env.BOOTSTRAP_ADMIN_PHONE ?? "",
    password: env.BOOTSTRAP_ADMIN_PASSWORD ?? "",
  });
  if (!parsed.success) {
    console.error(`Not created: ${parsed.error.issues.map((i) => i.message).join("; ")}.`);
    return 1;
  }
  const admin = parsed.data;

  const clash = await prisma.user.findFirst({
    where: { OR: [{ email: admin.email }, { phone: admin.phone }] },
    select: { email: true, isActive: true },
  });
  if (clash) {
    console.error(`Not created: a ${clash.isActive ? "" : "deactivated "}user already has this email or phone (${clash.email}).`);
    return 1;
  }

  const role = await prisma.role.findUniqueOrThrow({ where: { name: "Admin" } });
  const passwordHash = await bcrypt.hash(admin.password, 10);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        passwordHash,
        roleId: role.id,
        isActive: true,
        isOnboarding: false,
        mustChangePassword: true,
        joinedAt: dhakaDateBound(new Date()), // @db.Date — today's Dhaka day
      },
    });
    await tx.auditLog.create({
      data: {
        userId: u.id,
        action: "user.create",
        entity: "users",
        entityId: String(u.id),
        afterJson: { name: u.name, email: u.email, phone: u.phone, role: "Admin", via: "db:bootstrap" },
      },
    });
    return u;
  });
  console.log(`Admin created: ${user.name} <${user.email}>, ${user.phone}. They must change the password at first sign-in.`);
  return 0;
}

async function main() {
  await base();
  return firstAdmin();
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
