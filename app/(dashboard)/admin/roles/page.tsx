import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { RolesClient } from "@/components/admin/roles-client";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  await requirePagePermission("users.manage");

  const roles = await prisma.role.findMany({
    orderBy: { id: "asc" },
    include: { rolePermissions: { include: { permission: true } } },
  });

  return (
    <RolesClient
      roles={roles.map((r) => ({
        id: r.id,
        name: r.name,
        permissionKeys: r.rolePermissions.map((rp) => rp.permission.key),
      }))}
    />
  );
}
