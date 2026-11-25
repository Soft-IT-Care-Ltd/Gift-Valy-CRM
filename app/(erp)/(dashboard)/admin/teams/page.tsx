import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/page-auth";
import { TeamsClient } from "@/components/admin/teams-client";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  await requirePagePermission("users.manage");

  const [teams, users] = await Promise.all([
    prisma.team.findMany({
      orderBy: { name: "asc" },
      include: {
        leader: true,
        members: { where: { isActive: true }, orderBy: { name: "asc" } },
      },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <TeamsClient
      teams={teams.map((t) => ({
        id: t.id,
        name: t.name,
        leaderUserId: t.leaderUserId,
        leaderName: t.leader?.name ?? null,
        memberNames: t.members.map((m) => m.name),
      }))}
      users={users}
    />
  );
}
