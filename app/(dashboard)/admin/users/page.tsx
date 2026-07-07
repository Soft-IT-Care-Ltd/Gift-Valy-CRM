import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { UsersClient } from "@/components/admin/users-client";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requirePagePermission("users.manage");

  const [users, roles, teams] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: {
        role: true,
        team: true,
        _count: { select: { overrides: true } },
      },
    }),
    prisma.role.findMany({ orderBy: { id: "asc" } }),
    prisma.team.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <UsersClient
      users={users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        roleId: u.roleId,
        roleName: u.role.name,
        teamId: u.teamId,
        teamName: u.team?.name ?? null,
        isActive: u.isActive,
        isOnboarding: u.isOnboarding,
        mustChangePassword: u.mustChangePassword,
        joinedAt: u.joinedAt?.toISOString().slice(0, 10) ?? null,
        overridesCount: u._count.overrides,
      }))}
      roles={roles.map((r) => ({ id: r.id, name: r.name }))}
      teams={teams.map((t) => ({ id: t.id, name: t.name }))}
    />
  );
}
