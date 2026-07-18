// Role-based home dashboards (SPEC §13): SE sees own funnel/target/follow-ups;
// TL sees the team; Packing sees the packing queue; Accounts sees the collection
// + verification queue. All server components — cost/profit fields never reach a
// Sales/TL/Packing viewer because they simply aren't rendered.
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import type { Session } from "next-auth";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { dhakaDayStart, dhakaMonthStart } from "@/lib/orders";
import { EXCLUDED_SALE_STATUSES } from "@/lib/order-constants";
import { buildCommittedQueue, leadScopeWhere } from "@/lib/leads";
import { dhakaYm, buildDailySummary } from "@/lib/pnl";
import { buildUserGauge, buildTeamGauge, buildLeaderboard } from "@/lib/targets";
import { buildFunnel } from "@/lib/dashboard";
import { buildCollectionReport, buildCourierReport, buildStockReport } from "@/lib/reports";
import { money, formatDateTime } from "@/lib/format";
import { StatusBadge } from "@/components/orders/orders-list-client";
import { StatTile } from "./stat-tile";
import { Funnel, ProgressBar, chartColor } from "./charts";
import { FollowUpsWidget } from "./follow-ups-widget";
import { OccasionRemindersWidget } from "./occasion-reminders-widget";

// ---------- shared bits ----------

// Committed queue (CORRECTIONS Leads §9) — leads that promised the advance but
// haven't paid, oldest commitment first. Shown on the SE/TL homes so they get
// chased until the payment lands.
async function CommittedQueueCard({
  session,
  permissions,
}: {
  session: Session;
  permissions: string[];
}) {
  const scope = await leadScopeWhere(session, permissions);
  const committed = await buildCommittedQueue(scope, prisma, 8);
  if (committed.length === 0) return null;
  return (
    <Card className="border-amber-400/60">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">
            💰 Committed — awaiting payment ({committed.length})
          </CardTitle>
          <CardDescription>
            Promised the advance, hasn&apos;t paid — chase these first.
          </CardDescription>
        </div>
        <Button variant="outline" asChild>
          <Link href="/leads">Open leads</Link>
        </Button>
      </CardHeader>
      <CardContent className="grid gap-2">
        {committed.map((l) => (
          <div
            key={l.id}
            className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <span className="font-medium">
              {l.customerName ?? l.whatsappNumber}
            </span>
            <span className="text-xs text-muted-foreground">
              {l.whatsappNumber} · {l.assignedToName}
            </span>
            <Badge
              variant={l.chaseOverdue ? "destructive" : "secondary"}
              className="ml-auto whitespace-nowrap"
            >
              committed {l.committedSince} ago
            </Badge>
            {l.convertedOrder && (
              <Link
                href={`/orders/${l.convertedOrder.id}`}
                className="font-mono text-xs underline underline-offset-2"
              >
                {l.convertedOrder.orderNo}
              </Link>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function GaugeCard({
  title,
  subtitle,
  gauge,
}: {
  title: string;
  subtitle: string;
  gauge: {
    targetAmount: number | null;
    targetOrders: number | null;
    achievedAmount: number;
    achievedOrders: number;
    primaryPct: number | null;
    daysLeft: number;
    requiredDailyAmount: number | null;
    requiredDailyOrders: number | null;
  };
}) {
  const hasTarget = gauge.targetAmount != null || gauge.targetOrders != null;
  const done = (gauge.primaryPct ?? 0) >= 100;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasTarget ? (
          <p className="text-sm text-muted-foreground">
            No target set for this month yet.
          </p>
        ) : (
          <>
            <div className="flex items-end justify-between">
              <div className="text-2xl font-bold tabular-nums">
                {gauge.primaryPct ?? 0}%
              </div>
              <div className="text-right text-sm text-muted-foreground">
                {gauge.targetAmount != null
                  ? `${money(gauge.achievedAmount)} / ${money(gauge.targetAmount)}`
                  : `${gauge.achievedOrders} / ${gauge.targetOrders} orders`}
              </div>
            </div>
            <ProgressBar
              pct={gauge.primaryPct}
              color={done ? "var(--success)" : chartColor(0)}
            />
            <div className="text-xs text-muted-foreground">
              {done ? (
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  Target reached — keep stacking. 🎉
                </span>
              ) : gauge.daysLeft > 0 ? (
                <>
                  {gauge.daysLeft} day{gauge.daysLeft === 1 ? "" : "s"} left · need{" "}
                  {gauge.targetAmount != null
                    ? `${money(gauge.requiredDailyAmount ?? 0)}/day`
                    : `${gauge.requiredDailyOrders ?? 0} orders/day`}
                </>
              ) : (
                "Month closed."
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

async function RecentOrders({
  where,
  title,
  description,
}: {
  where: Prisma.OrderWhereInput;
  title: string;
  description: string;
}) {
  const recent = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { customer: { select: { name: true } } },
  });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button variant="outline" asChild>
          <Link href="/orders">View all</Link>
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  <Link
                    href={`/orders/${o.id}`}
                    className="font-mono text-sm underline-offset-2 hover:underline"
                  >
                    {o.orderNo}
                  </Link>
                </TableCell>
                <TableCell>{o.customer.name}</TableCell>
                <TableCell className="text-right">
                  {money(Number(o.totalAmount))}
                </TableCell>
                <TableCell className="text-right">
                  <span className={Number(o.dueAmount) > 0 ? "text-amber-700 dark:text-amber-500" : ""}>
                    {money(Number(o.dueAmount))}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusBadge status={o.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(o.createdAt.toISOString())}
                </TableCell>
              </TableRow>
            ))}
            {recent.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No orders yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------- SE home ----------

export async function SalesExecutiveHome({
  session,
  permissions,
  userId,
  userName,
}: {
  session: Session;
  permissions: string[];
  userId: number;
  userName: string;
}) {
  const monthKey = dhakaYm();
  const monthStart = dhakaMonthStart();
  const sale = { salesExecutiveId: userId, status: { notIn: EXCLUDED_SALE_STATUSES } };

  const [today, month, gauge, funnel] = await Promise.all([
    prisma.order.aggregate({
      where: { ...sale, createdAt: { gte: dhakaDayStart() } },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    prisma.order.aggregate({
      where: { ...sale, createdAt: { gte: monthStart } },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    buildUserGauge({ id: userId, name: userName }, monthKey, new Date()),
    buildFunnel({ salesExecutiveId: userId, createdAt: { gte: monthStart } }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {userName} · your sales, target and follow-ups
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="My orders today"
          value={today._count._all}
          sub={`${money(Number(today._sum.totalAmount ?? 0))} value`}
          href="/orders/new"
        />
        <StatTile
          label="My sales this month"
          value={money(Number(month._sum.totalAmount ?? 0))}
          sub={`${month._count._all} orders`}
          href="/orders"
        />
        <StatTile
          label="Target progress"
          value={gauge.primaryPct != null ? `${gauge.primaryPct}%` : "—"}
          sub={
            gauge.targetAmount != null
              ? `of ${money(gauge.targetAmount)}`
              : gauge.targetOrders != null
                ? `of ${gauge.targetOrders} orders`
                : "no target set"
          }
          href="/targets"
        />
        <StatTile
          label="Days left this month"
          value={gauge.daysLeft}
          sub={
            gauge.requiredDailyAmount != null
              ? `need ${money(gauge.requiredDailyAmount)}/day`
              : "keep going"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GaugeCard
          title="My monthly target"
          subtitle="Live progress toward this month's target"
          gauge={gauge}
        />
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">My order funnel</CardTitle>
            <CardDescription>
              My orders this month, by furthest stage reached
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Funnel stages={funnel.funnel} />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>On hold: {funnel.funnelExtra.onHold}</span>
              <span>Cancelled / returned: {funnel.funnelExtra.cancelledReturned}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {permissions.includes("leads.view_own") && (
        <>
          <CommittedQueueCard session={session} permissions={permissions} />
          <FollowUpsWidget session={session} permissions={permissions} />
        </>
      )}

      {permissions.includes("orders.view_own") && (
        <OccasionRemindersWidget session={session} permissions={permissions} />
      )}

      <RecentOrders
        where={{ salesExecutiveId: userId }}
        title="My recent orders"
        description="Your latest entries, all statuses."
      />
    </div>
  );
}

// ---------- TL home ----------

export async function TeamLeaderHome({
  session,
  permissions,
  userId,
  userName,
}: {
  session: Session;
  permissions: string[];
  userId: number;
  userName: string;
}) {
  const monthKey = dhakaYm();
  const monthStart = dhakaMonthStart();

  // Teams this TL is responsible for (led teams + own team).
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { teamId: true, leaderOf: { select: { id: true, name: true } } },
  });
  const teamMap = new Map<number, string>();
  for (const t of me?.leaderOf ?? []) teamMap.set(t.id, t.name);
  if (me?.teamId && !teamMap.has(me.teamId)) {
    const t = await prisma.team.findUnique({
      where: { id: me.teamId },
      select: { name: true },
    });
    if (t) teamMap.set(me.teamId, t.name);
  }
  const teamIds = [...teamMap.keys()];

  const teamSale = {
    teamId: teamIds.length ? { in: teamIds } : { equals: -1 },
    status: { notIn: EXCLUDED_SALE_STATUSES },
  } as const;

  const [today, month, funnel, gauges, leaderboard, members] = await Promise.all([
    prisma.order.aggregate({
      where: { ...teamSale, createdAt: { gte: dhakaDayStart() } },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    prisma.order.aggregate({
      where: { ...teamSale, createdAt: { gte: monthStart } },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    buildFunnel({
      teamId: teamIds.length ? { in: teamIds } : { equals: -1 },
      createdAt: { gte: monthStart },
    }),
    Promise.all(
      [...teamMap.entries()].map(([id, name]) =>
        buildTeamGauge({ id, name }, monthKey, new Date())
      )
    ),
    buildLeaderboard(monthKey),
    prisma.user.findMany({
      where: { teamId: teamIds.length ? { in: teamIds } : { equals: -1 } },
      select: { id: true },
    }),
  ]);

  const memberIds = new Set(members.map((m) => m.id));
  const teamBoard = leaderboard.filter((r) => memberIds.has(r.userId));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Team dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {userName} ·{" "}
          {teamMap.size > 0 ? [...teamMap.values()].join(", ") : "your team"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Team orders today"
          value={today._count._all}
          sub={`${money(Number(today._sum.totalAmount ?? 0))} value`}
        />
        <StatTile
          label="Team sales this month"
          value={money(Number(month._sum.totalAmount ?? 0))}
          sub={`${month._count._all} orders`}
          href="/orders"
        />
        <StatTile
          label="Members"
          value={memberIds.size}
          sub="active on the team"
          href="/targets"
        />
        <StatTile
          label="Team target"
          value={
            gauges[0]?.primaryPct != null ? `${gauges[0].primaryPct}%` : "—"
          }
          sub={gauges.length ? "toward this month" : "no target set"}
          href="/targets"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Team target progress</CardTitle>
            <CardDescription>This month</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {gauges.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No team target set for this month.
              </p>
            )}
            {gauges.map((g) => (
              <div key={g.subjectId}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{g.subjectName}</span>
                  <span className="text-muted-foreground">
                    {g.targetAmount != null
                      ? `${money(g.achievedAmount)} / ${money(g.targetAmount)}`
                      : `${g.achievedOrders} orders`}
                    {g.primaryPct != null && (
                      <span className="ml-1 font-semibold text-foreground">
                        {g.primaryPct}%
                      </span>
                    )}
                  </span>
                </div>
                <ProgressBar
                  pct={g.primaryPct}
                  color={(g.primaryPct ?? 0) >= 100 ? "var(--success)" : chartColor(0)}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Team order funnel</CardTitle>
            <CardDescription>This month, by furthest stage</CardDescription>
          </CardHeader>
          <CardContent>
            <Funnel stages={funnel.funnel} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base">Team leaderboard</CardTitle>
            <CardDescription>This month · by sales value</CardDescription>
          </div>
          <Link href="/targets" className="text-sm underline underline-offset-2">
            Targets
          </Link>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Executive</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Sales</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teamBoard.map((r, i) => (
                <TableRow key={r.userId}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.orders}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.amount)}
                  </TableCell>
                </TableRow>
              ))}
              {teamBoard.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No sales from the team yet this month.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {permissions.includes("leads.view_own") && (
        <>
          <CommittedQueueCard session={session} permissions={permissions} />
          <FollowUpsWidget session={session} permissions={permissions} />
        </>
      )}

      {permissions.includes("orders.view_own") && (
        <OccasionRemindersWidget session={session} permissions={permissions} />
      )}
    </div>
  );
}

// ---------- Packing home ----------

export async function PackingHome({ userName }: { userName: string }) {
  const [queueCount, oldest, queue, stock] = await Promise.all([
    prisma.order.count({ where: { status: "CONFIRMED" } }),
    prisma.order.findFirst({
      where: { status: "CONFIRMED" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.order.findMany({
      where: { status: "CONFIRMED" },
      orderBy: { createdAt: "asc" },
      take: 8,
      include: { customer: { select: { name: true } } },
    }),
    buildStockReport(false), // Packing has stock.view but never costs
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Packing dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {userName} · your queue and stock health
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Orders to pack"
          value={queueCount}
          sub="CONFIRMED, oldest first"
          tone={queueCount > 0 ? "warning" : "default"}
          href="/packing"
        />
        <StatTile
          label="Oldest waiting"
          value={oldest ? formatDateTime(oldest.createdAt.toISOString()) : "—"}
          sub={oldest ? "since confirmation" : "queue empty"}
          href="/packing"
        />
        <StatTile
          label="Low-stock alerts"
          value={stock.lowStockCount}
          sub="products at/below threshold"
          tone={stock.lowStockCount > 0 ? "negative" : "default"}
          href="/stock"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Next to pack</CardTitle>
            <CardDescription>Oldest confirmed orders awaiting packing.</CardDescription>
          </div>
          <Button asChild>
            <Link href="/packing">Open packing queue</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>District</TableHead>
                <TableHead>Confirmed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <Link
                      href={`/orders/${o.id}`}
                      className="font-mono text-sm underline-offset-2 hover:underline"
                    >
                      {o.orderNo}
                    </Link>
                  </TableCell>
                  <TableCell>{o.recipientName}</TableCell>
                  <TableCell className="text-muted-foreground">{o.district}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(o.createdAt.toISOString())}
                  </TableCell>
                </TableRow>
              ))}
              {queue.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    Queue is clear — nothing waiting to pack. 🎉
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Accounts home ----------

export async function AccountsHome({ userName }: { userName: string }) {
  const [todaySum, monthSum, collection, courier, pending, pendingAgg] =
    await Promise.all([
      buildDailySummary({ from: dhakaDayStart() }),
      buildDailySummary({ from: dhakaMonthStart() }),
      buildCollectionReport({}),
      buildCourierReport(),
      prisma.payment.findMany({
        where: { isVerified: false, isRejected: false },
        orderBy: { paymentDate: "asc" },
        take: 8,
        include: {
          wallet: { select: { name: true } },
          order: { select: { id: true, orderNo: true, customer: { select: { name: true } } } },
        },
      }),
      prisma.payment.aggregate({
        where: { isVerified: false, isRejected: false },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

  const pendingCount = pendingAgg._count;
  const pendingAmount = Number(pendingAgg._sum.amount ?? 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Accounts dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {userName} · collection and verification queue
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Pending verification"
          value={pendingCount}
          sub={`${money(pendingAmount)} to sign off`}
          tone={pendingCount > 0 ? "warning" : "default"}
          href="/money/verification"
        />
        <StatTile
          label="Collected today"
          value={money(todaySum.totals.collection)}
          sub="net of refunds"
          href="/reports/collection"
        />
        <StatTile
          label="Collected this month"
          value={money(monthSum.totals.collection)}
          sub="net of refunds"
          href="/reports/collection"
        />
        <StatTile
          label="Dues outstanding"
          value={money(collection.dues.totalOutstanding)}
          sub={`${collection.dues.orderCount} orders owing`}
          tone={collection.dues.totalOutstanding > 0 ? "warning" : "default"}
          href="/reports/collection"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <StatTile
          label="COD pending with courier"
          value={money(courier.codPending.amount)}
          sub={`${courier.codPending.count} shipments`}
          tone={courier.codPending.count > 0 ? "warning" : "default"}
          href="/reports/courier"
        />
        <StatTile
          label="Awaiting handover"
          value={courier.pendingHandoverCount}
          sub="packed, no shipment yet"
          href="/courier/shipments"
        />
        <StatTile
          label="Rejected (this month)"
          value={collection.rejected.count}
          sub={`${money(collection.rejected.amount)} not received`}
          href="/reports/collection"
        />
      </div>

      <Card className={pendingCount > 0 ? "border-amber-400/50" : ""}>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Verification queue</CardTitle>
            <CardDescription>
              Payments awaiting sign-off against the wallet statement.
            </CardDescription>
          </div>
          <Button asChild>
            <Link href="/money/verification">Open queue</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Wallet</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/orders/${p.order.id}`}
                      className="font-mono text-sm underline-offset-2 hover:underline"
                    >
                      {p.order.orderNo}
                    </Link>
                  </TableCell>
                  <TableCell>{p.order.customer.name}</TableCell>
                  <TableCell className="text-muted-foreground">{p.method}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.wallet?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(Number(p.amount))}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(p.paymentDate.toISOString())}
                  </TableCell>
                </TableRow>
              ))}
              {pending.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Nothing pending — all payments verified. 🎉
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
