import { prisma } from "./db";

// Effective permissions = role permissions, then per-user overrides applied
// (allow=true adds, allow=false removes). Admin always has everything —
// bypass prevents the owner from ever locking themselves out via the matrix UI.
export async function getEffectivePermissions(userId: number): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: {
        include: { rolePermissions: { include: { permission: true } } },
      },
      overrides: { include: { permission: true } },
    },
  });
  if (!user || !user.isActive) return [];

  if (user.role.name === "Admin") {
    const all = await prisma.permission.findMany({ select: { key: true } });
    return all.map((p) => p.key);
  }

  const keys = new Set(user.role.rolePermissions.map((rp) => rp.permission.key));
  for (const o of user.overrides) {
    if (o.allow) keys.add(o.permission.key);
    else keys.delete(o.permission.key);
  }
  return [...keys];
}
