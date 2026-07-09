import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getEffectivePermissions } from "@/lib/rbac";
import { PERMISSION_DEFS, ROLE_LABELS, type RoleName } from "@/lib/permissions";
import { dhakaDayStart, dhakaMonthStart } from "@/lib/orders";
import { buildFollowUps, leadScopeWhere } from "@/lib/leads";
import { canSeeCosts } from "@/lib/catalog";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from "@/lib/lead-constants";
import { buildStockReport, buildPackageReport } from "@/lib/reports";
import { money, formatDateTime } from "@/lib/format";
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
import { StatusBadge } from "@/components/orders/orders-list-client";
import { SupplierDuesAlert } from "@/components/purchases/supplier-dues-alert";
import type { OrderStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

// §4.2: cancelled orders are excluded from sales numbers; returned/refunded
// sales are money that came back, so they don't count either.
const NON_SALE_STATUSES: OrderStatus[] = ["CANCELLED", "RETURNED", "REFUNDED"];

// SPEC §13 role-based dashboards — SE home: my orders today, my sales this
// month (count + value), recent orders.
async function SalesExecutiveHome({ userId }: { userId: number }) {
  const mine = { salesExecutiveId: userId };
  const sale = { ...mine, status: { notIn: NON_SALE_STATUSES } };
  const [today, month, recent] = await Promise.all([
    prisma.order.aggregate({
      where: { ...sale, createdAt: { gte: dhakaDayStart() } },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    prisma.order.aggregate({
      where: { ...sale, createdAt: { gte: dhakaMonthStart() } },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    prisma.order.findMany({
      where: mine,
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { customer: { select: { name: true } } },
    }),
  ]);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>My orders today</CardDescription>
            <CardTitle className="text-3xl">{today._count._all}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {money(Number(today._sum.totalAmount ?? 0))} in sales value
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>My sales this month</CardDescription>
            <CardTitle className="text-3xl">
              {month._count._all}
              <span className="ml-2 text-lg font-semibold text-muted-foreground">
                orders · {money(Number(month._sum.totalAmount ?? 0))}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Cancelled and returned orders are not counted.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Recent orders</CardTitle>
            <CardDescription>Your latest entries, all statuses.</CardDescription>
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
                    <span className={Number(o.dueAmount) > 0 ? "text-amber-700" : ""}>
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
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground"
                  >
                    No orders yet — create your first one.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

// SPEC §13 Row 3 (Operations): stock value + low-stock alert count + package
// availability alerts. Rendered for any stock.view role; the numbers come from
// the same builders as the R4/R5 reports, so a dashboard glance and the report
// always agree. Stock value is cost data — populated only for cost-visible
// roles (canSeeCosts), so Packing sees the alert counts but not the value.
async function InventorySummary({ showCosts }: { showCosts: boolean }) {
  const [stock, pkg] = await Promise.all([
    buildStockReport(showCosts),
    buildPackageReport(showCosts),
  ]);
  const trackedCount = stock.rows.filter((r) => r.isStockTracked).length;
  const activePackages = pkg.rows.filter((r) => r.isActive);
  const packageAlerts = activePackages.filter((r) => r.buildable === 0).length;

  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-muted-foreground">
        Inventory
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {showCosts && stock.totalStockValue != null && (
          <Link href="/reports/stock">
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader className="pb-2">
                <CardDescription>Stock value</CardDescription>
                <CardTitle className="text-2xl">
                  {money(stock.totalStockValue)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Across {trackedCount} tracked products
              </CardContent>
            </Card>
          </Link>
        )}
        <Link href="/reports/stock">
          <Card
            className={`h-full transition-colors hover:bg-muted/50 ${
              stock.lowStockCount > 0 ? "border-destructive/40" : ""
            }`}
          >
            <CardHeader className="pb-2">
              <CardDescription>Low-stock alerts</CardDescription>
              <CardTitle
                className={`text-2xl ${stock.lowStockCount > 0 ? "text-destructive" : ""}`}
              >
                {stock.lowStockCount}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {stock.lowStockCount > 0
                ? "Products at or below their threshold"
                : "All products above threshold"}
            </CardContent>
          </Card>
        </Link>
        <Link href="/reports/packages">
          <Card
            className={`h-full transition-colors hover:bg-muted/50 ${
              packageAlerts > 0 ? "border-destructive/40" : ""
            }`}
          >
            <CardHeader className="pb-2">
              <CardDescription>Package availability alerts</CardDescription>
              <CardTitle
                className={`text-2xl ${packageAlerts > 0 ? "text-destructive" : ""}`}
              >
                {packageAlerts}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {packageAlerts > 0
                ? `Can't build ${packageAlerts} of ${activePackages.length} packages`
                : `All ${activePackages.length} packages buildable`}
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}

// SPEC §3.2 — follow-up reminders on the SE dashboard ("Today's follow-ups"),
// overdue ones flagged red. Shown to any lead-viewing role at their scope.
async function FollowUpsWidget({
  session,
  permissions,
}: {
  session: Session;
  permissions: string[];
}) {
  const scope = await leadScopeWhere(session, permissions);
  const fu = await buildFollowUps(scope);
  if (fu.todayCount === 0 && fu.overdueCount === 0) return null;

  const rows = [
    ...fu.overdue.map((l) => ({ l, overdue: true })),
    ...fu.today.map((l) => ({ l, overdue: false })),
  ].slice(0, 8);

  return (
    <Card className={fu.overdueCount > 0 ? "border-destructive/40" : ""}>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">
            Today&apos;s follow-ups: {fu.todayCount}
          </CardTitle>
          <CardDescription>
            {fu.overdueCount > 0 ? (
              <span className="font-medium text-destructive">
                {fu.overdueCount} overdue — act now
              </span>
            ) : (
              "Leads due for a follow-up today."
            )}
          </CardDescription>
        </div>
        <Button variant="outline" asChild>
          <Link href="/leads">Open leads</Link>
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Follow-up</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ l, overdue }) => (
              <TableRow key={l.id}>
                <TableCell>
                  <div className="font-medium">{l.customerName ?? l.whatsappNumber}</div>
                  {l.customerName && (
                    <div className="text-xs text-muted-foreground">{l.whatsappNumber}</div>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {LEAD_SOURCE_LABELS[l.source]}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{LEAD_STATUS_LABELS[l.status]}</Badge>
                </TableCell>
                <TableCell
                  className={overdue ? "font-medium text-destructive" : "text-muted-foreground"}
                >
                  {l.followUpAt ? formatDateTime(l.followUpAt) : "—"}
                  {overdue ? " · overdue" : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default async function HomePage() {
  // Pages render in parallel with the layout, so guard here too.
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true, team: true },
  });
  if (!user) return null;

  const permissions = await getEffectivePermissions(user.id);
  const groups = new Map<string, string[]>();
  for (const def of PERMISSION_DEFS) {
    if (!permissions.includes(def.key)) continue;
    const list = groups.get(def.group) ?? [];
    list.push(def.label);
    groups.set(def.group, list);
  }

  const roleLabel = ROLE_LABELS[user.role.name as RoleName] ?? user.role.name;
  const isSalesExecutive = user.role.name === "SalesExecutive";

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
        {isSalesExecutive && permissions.includes("orders.create") && (
          <CardContent>
            <Button asChild>
              <Link href="/orders/new">+ New order</Link>
            </Button>
          </CardContent>
        )}
        {permissions.includes("users.manage") && (
          <CardContent className="flex flex-wrap gap-2 text-sm">
            <Link className="underline" href="/admin/users">
              Manage users
            </Link>
            <span>·</span>
            <Link className="underline" href="/admin/teams">
              Manage teams
            </Link>
            <span>·</span>
            <Link className="underline" href="/admin/roles">
              Permission matrix
            </Link>
          </CardContent>
        )}
      </Card>

      {permissions.includes("leads.view_own") && (
        <FollowUpsWidget session={session} permissions={permissions} />
      )}

      {permissions.includes("purchases.create") && <SupplierDuesAlert />}

      {permissions.includes("stock.view") && (
        <InventorySummary showCosts={canSeeCosts(permissions)} />
      )}

      {isSalesExecutive && <SalesExecutiveHome userId={user.id} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your access</CardTitle>
          <CardDescription>
            What your role ({roleLabel}) can do. Modules ship phase by phase —
            Leads, Orders, Stock and the rest arrive in the next build steps.
          </CardDescription>
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
