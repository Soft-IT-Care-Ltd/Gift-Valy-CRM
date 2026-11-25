import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEffectivePermissions } from "@/lib/rbac";
import { visibleGauges, buildLeaderboard, getUserRewards } from "@/lib/targets";
import {
  monthKeyOf,
  monthLabel,
  MONTH_KEY_RE,
  REWARD_STATUS_LABELS,
  serializeReward,
} from "@/lib/targets-constants";
import { money, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GaugeCard } from "@/components/targets/gauge-card";
import { MonthSwitcher } from "@/components/targets/month-switcher";
import { LeaderboardTable } from "@/components/targets/leaderboard-table";

export const dynamic = "force-dynamic";

// SPEC §10 — Targets & Rewards home. Everyone sees the leaderboard; SEs see
// their own gauge, TLs their team's, Admin/Manager all — enforced in
// visibleGauges. Reward amounts shown here are the viewer's OWN only.
export default async function TargetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const permissions = await getEffectivePermissions(session.user.id);

  const sp = await searchParams;
  const now = new Date();
  const monthKey =
    sp.month && MONTH_KEY_RE.test(sp.month) ? sp.month : monthKeyOf(now);

  const canManage = permissions.includes("targets.manage");
  const canViewGauges = permissions.includes("targets.view_own");

  const [gauges, leaderboard, myRewardsRaw] = await Promise.all([
    canViewGauges
      ? visibleGauges(session, permissions, monthKey, now)
      : Promise.resolve({ own: null, teams: [], members: [] }),
    buildLeaderboard(monthKey),
    getUserRewards(session.user.id),
  ]);
  const myRewards = myRewardsRaw.map(serializeReward);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Targets &amp; Rewards</h1>
          <p className="text-sm text-muted-foreground">
            {monthLabel(monthKey)} progress and the monthly leaderboard.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSwitcher monthKey={monthKey} />
          {canManage && (
            <Button asChild>
              <Link href="/targets/manage">Manage</Link>
            </Button>
          )}
        </div>
      </div>

      {/* My gauge */}
      {gauges.own && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            My progress
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <GaugeCard gauge={gauges.own} />
          </div>
        </section>
      )}

      {/* Team gauges */}
      {gauges.teams.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Team progress
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {gauges.teams.map((g) => (
              <GaugeCard key={`team-${g.subjectId}`} gauge={g} />
            ))}
          </div>
        </section>
      )}

      {/* Member gauges */}
      {gauges.members.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {canManage ? "All individuals" : "Team members"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {gauges.members.map((g) => (
              <GaugeCard key={`user-${g.subjectId}`} gauge={g} />
            ))}
          </div>
        </section>
      )}

      {/* Leaderboard — everyone */}
      <LeaderboardTable
        rows={leaderboard}
        monthKey={monthKey}
        highlightUserId={session.user.id}
      />

      {/* My reward history (own amounts only) */}
      {myRewards.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">My rewards</CardTitle>
            <CardDescription>
              Your bonus history. Only you and Admin see your amounts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Approved</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myRewards.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{monthLabel(r.monthKey)}</TableCell>
                      <TableCell>
                        {r.ruleName}
                        {r.achievementPercent != null && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({r.achievementPercent}%)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {money(r.amount)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.status === "PAID"
                              ? "default"
                              : r.status === "APPROVED"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {REWARD_STATUS_LABELS[r.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.approvedAt ? formatDate(r.approvedAt) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
