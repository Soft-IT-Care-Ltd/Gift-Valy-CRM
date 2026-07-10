import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getEffectivePermissions } from "@/lib/rbac";
import { ROLE_LABELS, type RoleName } from "@/lib/permissions";
import { canSeeCosts } from "@/lib/catalog";
import { resolveDashWindow, buildOwnerDashboard } from "@/lib/dashboard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PERMISSION_DEFS } from "@/lib/permissions";
import { OwnerDashboard } from "@/components/dashboard/owner-dashboard";
import {
  SalesExecutiveHome,
  TeamLeaderHome,
  PackingHome,
  AccountsHome,
} from "@/components/dashboard/role-homes";

export const dynamic = "force-dynamic";

// SPEC §13 — Owner Dashboard + role-based home dashboards. This page routes each
// signed-in user to the screen that matches their reach:
//   • dashboard.owner / orders.view_all → the full 5-row Owner Dashboard
//     (Admin sees costs & P&L; a Manager without reports.pnl sees the same
//      screen with cost/profit widgets withheld — canSeeCosts gates rendering).
//   • SalesExecutive → own funnel / target / follow-ups
//   • TeamLeader     → team funnel / target / leaderboard
//   • Packing        → packing queue + stock health
//   • Accounts       → collection + verification queue
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true, team: true },
  });
  if (!user) return null;

  const permissions = await getEffectivePermissions(user.id);
  const role = user.role.name as RoleName;
  const showCosts = canSeeCosts(permissions);

  // ── Owner / Manager: the full business-health dashboard ──
  if (permissions.includes("dashboard.owner") || permissions.includes("orders.view_all")) {
    const params = await searchParams;
    const win = resolveDashWindow(params);
    const data = await buildOwnerDashboard(win, { showCosts });
    return (
      <OwnerDashboard data={data} showCosts={showCosts} viewerName={user.name} />
    );
  }

  // ── Role-based home dashboards ──
  if (role === "SalesExecutive") {
    return (
      <SalesExecutiveHome
        session={session}
        permissions={permissions}
        userId={user.id}
        userName={user.name}
      />
    );
  }
  if (role === "TeamLeader") {
    return (
      <TeamLeaderHome
        session={session}
        permissions={permissions}
        userId={user.id}
        userName={user.name}
      />
    );
  }
  if (role === "Packing") {
    return <PackingHome userName={user.name} />;
  }
  if (role === "Accounts") {
    return <AccountsHome userName={user.name} />;
  }

  // ── Fallback: a plain access summary for any custom/other role ──
  const groups = new Map<string, string[]>();
  for (const def of PERMISSION_DEFS) {
    if (!permissions.includes(def.key)) continue;
    const list = groups.get(def.group) ?? [];
    list.push(def.label);
    groups.set(def.group, list);
  }
  const roleLabel = ROLE_LABELS[role] ?? user.role.name;

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Welcome, {user.name} 👋</CardTitle>
          <CardDescription>
            Signed in as <Badge variant="secondary">{roleLabel}</Badge>
            {user.team && <> · Team: {user.team.name}</>}
          </CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your access</CardTitle>
          <CardDescription>What your role ({roleLabel}) can do.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {[...groups.entries()].map(([group, labels]) => (
            <div key={group}>
              <div className="mb-1 text-sm font-semibold">{group}</div>
              <ul className="space-y-0.5 text-sm text-muted-foreground">
                {labels.map((l) => (
                  <li key={l}>• {l}</li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
