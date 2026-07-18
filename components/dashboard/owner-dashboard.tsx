// Owner Dashboard — the 5-row single-screen business-health view (SPEC §13).
// Server component: composes the aggregated data into money / month / operations
// / team / charts rows. Cost & profit widgets render only when showCosts.
import Link from "next/link";
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
import { money } from "@/lib/format";
import type { OwnerDashboardData } from "@/lib/dashboard";
import { WhoIsInCard } from "@/components/attendance/who-is-in-card";
import { StatTile } from "./stat-tile";
import { DateRangeSwitch } from "./date-range-switch";
import { CourierBalanceTile } from "./courier-balance-tile";
import { CollectionSyncButton } from "./collection-sync-button";
import { LineChart, Funnel, Donut, ProgressBar, chartColor } from "./charts";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 mt-1 text-sm font-semibold text-muted-foreground">
      {children}
    </h2>
  );
}

// CORRECTIONS Dashboard §5 — one line of the Total Collection breakdown.
// §R8: the Courier COD line carries an optional hover breakdown (gross −
// charges = net) and a sub-caption — both supplied by the caller, which
// cost-gates them.
function CollectionLine({
  label,
  value,
  colorIdx,
  sub,
  title,
}: {
  label: string;
  value: number;
  colorIdx: number;
  sub?: string;
  title?: string;
}) {
  return (
    <div className="rounded-lg border p-2.5" title={title}>
      <div className="flex items-center gap-1.5">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: chartColor(colorIdx) }}
        />
        <span className="truncate text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums">
        {money(value)}
      </div>
      {sub && (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {sub}
        </div>
      )}
    </div>
  );
}

export function OwnerDashboard({
  data,
  showCosts,
  viewerName,
  canManageCourier,
}: {
  data: OwnerDashboardData;
  showCosts: boolean;
  viewerName: string;
  canManageCourier: boolean;
}) {
  const {
    window: win,
    money: m,
    month,
    funnel,
    funnelExtra,
    inventory,
    snapshot: s,
  } = data;

  return (
    <div className="space-y-6">
      {/* Header + date-range switch */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Owner Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {viewerName} · full business health · {win.label}
          </p>
        </div>
        <DateRangeSwitch />
      </div>

      {/* ── Snapshot KPI strip (CORRECTIONS Dashboard §1–§7) ── */}
      <section>
        <SectionLabel>Snapshot · {win.label}</SectionLabel>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* §1 Leads */}
          <StatTile
            label={`${win.possessive} leads`}
            value={s.leads}
            sub={
              data.leads.conversionPct != null
                ? `${data.leads.conversionPct}% converted (${data.leads.converted})`
                : "New leads in range"
            }
            href="/leads"
          />
          {/* §2 Orders */}
          <StatTile
            label={`${win.possessive} orders`}
            value={s.orders}
            sub="Orders placed in range"
            href="/orders"
          />
          {/* §3 Delivered — count + total amount */}
          <StatTile
            label="Delivered"
            value={s.delivered.count}
            sub={`${money(s.delivered.amount)} order value`}
            href="/orders?status=DELIVERED"
          />
          {/* §7 Draft orders (Pending Payment) → Drafts tab */}
          <StatTile
            label="Draft orders (pending payment)"
            value={s.drafts.count}
            sub={`${money(s.drafts.amount)} committed · unpaid`}
            href="/orders?status=DRAFT"
            tone={s.drafts.count > 0 ? "warning" : "default"}
          />
          {/* §4 Advance collection — count + amount */}
          <StatTile
            label={`${win.possessive} advance collection`}
            value={money(s.advanceCollection.amount)}
            sub={`${s.advanceCollection.count} advance payment${
              s.advanceCollection.count === 1 ? "" : "s"
            }`}
          />
          {/* §6 Courier balance (live, client-fetched) + §R8 latest payout */}
          <CourierBalanceTile
            enabled={s.courierEnabled}
            canManage={canManageCourier}
            latestPayout={s.latestPayout}
          />
          {/* §5 Total collection with source breakdown. §R8: the Courier COD
              line is the NET payout (what reached the bank); its gross/charge
              breakdown is a COST view, hover-shown to cost-visible roles only.
              The refresh icon triggers the payments sync in place. */}
          <Card className="sm:col-span-2">
            <CardContent className="p-4">
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-medium text-muted-foreground">
                    Total collection
                  </div>
                  {canManageCourier && s.courierEnabled && (
                    <CollectionSyncButton />
                  )}
                </div>
                <div className="text-2xl font-bold tabular-nums">
                  {money(s.collection.total)}
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <CollectionLine
                  label="Advance"
                  value={s.collection.advance}
                  colorIdx={0}
                />
                <CollectionLine
                  label="Courier COD"
                  value={s.collection.cod}
                  colorIdx={1}
                  sub={
                    s.codBreakdown.payouts > 0
                      ? `Net payout · ${s.codBreakdown.payouts} payout${
                          s.codBreakdown.payouts === 1 ? "" : "s"
                        } (${s.codBreakdown.parcels} parcels)`
                      : "Net payout"
                  }
                  title={
                    showCosts && s.codBreakdown.payouts > 0
                      ? `Gross COD ${money(s.codBreakdown.grossSf)} − delivery charge ${money(
                          s.codBreakdown.deliveryCharge
                        )} − COD charge ${money(s.codBreakdown.codCharge)} = ${money(
                          s.codBreakdown.netSf
                        )}${
                          s.codBreakdown.manualCod > 0
                            ? ` · + manual COD ${money(s.codBreakdown.manualCod)}`
                            : ""
                        }`
                      : undefined
                  }
                />
                <CollectionLine
                  label="Post-delivery MFS"
                  value={s.collection.postMfs}
                  colorIdx={6}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Row 1 — Money (selected range) ── */}
      <section>
        <SectionLabel>Money · {win.label}</SectionLabel>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label={`${win.possessive} sales`}
            value={money(m.sales)}
            sub={`${m.orders} order${m.orders === 1 ? "" : "s"}`}
            href="/orders"
          />
          <StatTile
            label={`${win.possessive} collection`}
            value={money(m.collection)}
            sub="Payments received (net of refunds)"
            href={showCosts ? "/reports/collection" : undefined}
          />
          {showCosts && (
            <>
              <StatTile
                label={`${win.possessive} cost`}
                value={money(m.costs)}
                sub="Expenses paid, incl. ad"
                href="/reports/expenses"
              />
              <StatTile
                label={`${win.possessive} estimated profit`}
                value={money(m.net)}
                sub="Sales − costs"
                tone={m.net >= 0 ? "positive" : "negative"}
                href="/reports/pnl/daily"
              />
            </>
          )}
        </div>
      </section>

      {/* ── Row 2 — Month ── */}
      <section>
        <SectionLabel>This month</SectionLabel>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="lg:row-span-1">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">
                    MTD sales vs last month
                  </CardTitle>
                  <CardDescription>
                    {month.thisLabel} cumulative vs {month.lastLabel}
                  </CardDescription>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold tabular-nums">
                    {money(month.mtdSales)}
                  </div>
                  {month.deltaPct != null && (
                    <div
                      className={
                        month.deltaPct >= 0
                          ? "text-xs font-medium text-emerald-600 dark:text-emerald-400"
                          : "text-xs font-medium text-destructive"
                      }
                    >
                      {month.deltaPct >= 0 ? "▲" : "▼"} {Math.abs(month.deltaPct)}% vs
                      same period last month
                    </div>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <LineChart
                labels={month.labels}
                series={[
                  {
                    name: `${month.thisLabel} (MTD)`,
                    color: chartColor(0),
                    values: month.thisCumulative,
                  },
                  {
                    name: `${month.lastLabel}`,
                    color: chartColor(6),
                    values: month.lastCumulative,
                  },
                ]}
                height={160}
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            {showCosts && (
              <StatTile
                label="MTD net profit"
                value={money(month.mtdNet)}
                sub="Estimated (sales − costs)"
                tone={month.mtdNet >= 0 ? "positive" : "negative"}
                href="/reports/pnl/monthly"
              />
            )}
            <StatTile
              label="Dues outstanding"
              value={money(data.dues.totalOutstanding)}
              sub={`${data.dues.orderCount} order${
                data.dues.orderCount === 1 ? "" : "s"
              } owing`}
              tone={data.dues.totalOutstanding > 0 ? "warning" : "default"}
              href={showCosts ? "/reports/collection" : undefined}
            />
            <StatTile
              label="COD pending with courier"
              value={money(data.codPending.amount)}
              sub={`${data.codPending.count} shipment${
                data.codPending.count === 1 ? "" : "s"
              } to collect`}
              tone={data.codPending.count > 0 ? "warning" : "default"}
              href="/reports/courier"
            />
            {!showCosts && (
              <StatTile
                label="Leads → orders"
                value={
                  data.leads.conversionPct != null
                    ? `${data.leads.conversionPct}%`
                    : "—"
                }
                sub={`${data.leads.converted}/${data.leads.total} converted`}
                href="/leads/report"
              />
            )}
          </div>
        </div>
      </section>

      {/* ── Row 3 — Operations ── */}
      <section>
        <SectionLabel>Operations</SectionLabel>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Order status funnel</CardTitle>
              <CardDescription>
                Orders created {win.singleDay ? "today" : "in range"} ·{" "}
                {funnelExtra.totalInRange} total
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Funnel stages={funnel} />
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>On hold: {funnelExtra.onHold}</span>
                <span>Cancelled / returned: {funnelExtra.cancelledReturned}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Inventory health</CardTitle>
              <CardDescription>Live stock snapshot</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              {showCosts && (
                <Link href="/reports/stock" className="block rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Stock value</div>
                  <div className="mt-1 text-lg font-bold">
                    {inventory.stockValue != null ? money(inventory.stockValue) : "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {inventory.trackedCount} tracked products
                  </div>
                </Link>
              )}
              <Link
                href="/reports/stock"
                className={`block rounded-lg border p-3 ${
                  inventory.lowStockCount > 0 ? "border-destructive/40" : ""
                }`}
              >
                <div className="text-xs text-muted-foreground">Low-stock alerts</div>
                <div
                  className={`mt-1 text-lg font-bold ${
                    inventory.lowStockCount > 0 ? "text-destructive" : ""
                  }`}
                >
                  {inventory.lowStockCount}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  at/below threshold
                </div>
              </Link>
              <Link
                href="/reports/packages"
                className={`block rounded-lg border p-3 ${
                  inventory.packageAlerts > 0 ? "border-destructive/40" : ""
                }`}
              >
                <div className="text-xs text-muted-foreground">Package alerts</div>
                <div
                  className={`mt-1 text-lg font-bold ${
                    inventory.packageAlerts > 0 ? "text-destructive" : ""
                  }`}
                >
                  {inventory.packageAlerts}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  of {inventory.activePackages} not buildable
                </div>
              </Link>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Row 4 — Team ── */}
      <section>
        <SectionLabel>Team</SectionLabel>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base">SE leaderboard</CardTitle>
                <CardDescription>{month.thisLabel} · by sales value</CardDescription>
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
                  {data.leaderboard.map((r) => (
                    <TableRow key={r.userId}>
                      <TableCell className="text-muted-foreground">
                        {r.amountRank}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.name}</div>
                        {r.teamName && (
                          <div className="text-xs text-muted-foreground">
                            {r.teamName}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.orders}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(r.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.leaderboard.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No sales yet this month.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Team target progress</CardTitle>
                <CardDescription>{month.thisLabel}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.teamGauges.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No team targets set for this month.
                  </p>
                )}
                {data.teamGauges.map((g) => (
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
                      color={
                        (g.primaryPct ?? 0) >= 100 ? "var(--success)" : chartColor(0)
                      }
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <StatTile
                label={`${win.possessive} leads`}
                value={data.leads.total}
                sub={
                  data.leads.conversionPct != null
                    ? `${data.leads.conversionPct}% converted (${data.leads.converted})`
                    : "No conversions yet"
                }
                href="/leads/report"
              />
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs font-medium text-muted-foreground">
                    Conversion
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">
                    {data.leads.conversionPct != null
                      ? `${data.leads.conversionPct}%`
                      : "—"}
                  </div>
                  <div className="mt-2">
                    <ProgressBar pct={data.leads.conversionPct} color={chartColor(1)} />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
        <div className="mt-4">
          <WhoIsInCard data={data.whoIsIn} />
        </div>
      </section>

      {/* ── Row 5 — Charts ── */}
      <section>
        <SectionLabel>Trends</SectionLabel>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Sales &amp; collection · 30 days</CardTitle>
              <CardDescription>Daily totals, Asia/Dhaka</CardDescription>
            </CardHeader>
            <CardContent>
              <LineChart
                labels={data.trend30.points.map((p) => p.date.slice(5))}
                series={[
                  {
                    name: "Sales",
                    color: chartColor(0),
                    values: data.trend30.points.map((p) => p.sales),
                  },
                  {
                    name: "Collection",
                    color: chartColor(1),
                    values: data.trend30.points.map((p) => p.collection),
                  },
                ]}
                height={170}
                maxTicks={8}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Expense split</CardTitle>
              <CardDescription>{win.label}</CardDescription>
            </CardHeader>
            <CardContent>
              {showCosts && data.expenseSplit ? (
                <Donut
                  slices={data.expenseSplit.slices}
                  total={data.expenseSplit.total}
                  centerLabel="Expenses"
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Expense breakdown is available to cost-visible roles.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Country-wise sales</CardTitle>
            <CardDescription>
              Where the paying customers are · {win.label}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Country</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="w-40">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.countries.slice(0, 8).map((c, i) => (
                  <TableRow key={c.country}>
                    <TableCell className="font-medium">{c.country}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.orders}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(c.sales)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${c.share}%`, background: chartColor(i) }}
                          />
                        </div>
                        <span className="w-10 text-right text-xs text-muted-foreground">
                          {c.share}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {data.countries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No sales in this range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
