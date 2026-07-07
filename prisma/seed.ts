// Seed: 6 roles + permission matrix (SPEC §2), 1 Admin, 2 demo Sales Executives.
// Idempotent — safe to re-run (upserts everywhere).
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

  // 4. Users — Admin (owner) + 2 demo Sales Executives.
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
    await prisma.user.upsert({
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
  }

  console.log("Seed complete:");
  console.log(`  ${PERMISSION_DEFS.length} permissions, ${ROLE_NAMES.length} roles (matrix applied)`);
  console.log("  Team: Team Alpha");
  console.log("  Admin:  mh.neshad39@gmail.com / Admin@GV2026");
  console.log("  SE:     sanjoy@giftvaly.com   / Sales@GV2026");
  console.log("  SE:     partho@giftvaly.com   / Sales@GV2026");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
