import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { fmtDayMonth, type DeliveryPeriod } from "@/lib/delivery-schedule";
import type { DeliveryScheduleData, DeliveryRow } from "@/lib/delivery";
import { DeliveryPeriodFilter } from "@/components/delivery/delivery-period-filter";

// Delivery mode badge: ASAP is urgent (amber), FIXED shows its 🎯 target date,
// Any-day is flexible (muted).
function DeliveryModeBadge({ row }: { row: DeliveryRow }) {
  if (row.deliveryDateMode === "ASAP") {
    return (
      <Badge variant="outline" className="bg-amber-100 text-amber-800">
        ASAP
      </Badge>
    );
  }
  if (row.deliveryDateMode === "FIXED" && row.requestedDeliveryDate) {
    return (
      <Badge variant="outline" className="bg-violet-100 text-violet-800">
        🎯 {fmtDayMonth(row.requestedDeliveryDate)}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Any day
    </Badge>
  );
}

function ItemsCell({ items }: { items: { name: string; qty: number }[] }) {
  if (items.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const shown = items.slice(0, 2);
  const more = items.length - shown.length;
  return (
    <div
      className="flex flex-wrap gap-1"
      title={items.map((it) => `${it.qty}× ${it.name}`).join(", ")}
    >
      {shown.map((it, i) => (
        <span
          key={i}
          className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          {it.qty}× {it.name}
        </span>
      ))}
      {more > 0 && (
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          +{more} more
        </span>
      )}
    </div>
  );
}

export function DeliveryScheduleClient({
  data,
  period,
  from,
  to,
}: {
  data: DeliveryScheduleData;
  period: DeliveryPeriod;
  from: string;
  to: string;
}) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="gap-3">
          <div>
            <CardTitle>Delivery Schedule</CardTitle>
            <CardDescription>
              Deliveries still to go out (Confirmed &amp; Packed), grouped by
              requested date. ASAP orders sit in Today; fixed dates carry a 🎯
              badge.
            </CardDescription>
          </div>
          <DeliveryPeriodFilter
            basePath="/delivery-schedule"
            period={period}
            from={from}
            to={to}
          />
          {/* §3 — late-risk alert: fixed dates due today/tomorrow not yet packed */}
          {data.lateRiskCount > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <span className="font-semibold">
                ⚠ {data.lateRiskCount} fixed-date deliver
                {data.lateRiskCount === 1 ? "y" : "ies"} at risk
              </span>
              <span className="text-red-600/80 dark:text-red-400/80">
                — due today/tomorrow but still not packed. Pack &amp; hand over now.
              </span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {data.total === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No deliveries scheduled in this period.
            </p>
          ) : (
            <div className="grid gap-6">
              {data.groups.map((g) => (
                <div key={g.key}>
                  <div className="mb-2 flex items-center gap-2 border-b pb-1.5">
                    <h3
                      className={cn(
                        "text-sm font-semibold",
                        g.key === "overdue" && "text-red-600 dark:text-red-400"
                      )}
                    >
                      {g.label}
                    </h3>
                    <Badge variant="secondary" className="text-xs">
                      {g.rows.length}
                    </Badge>
                    {g.lateRiskCount > 0 && (
                      <Badge
                        variant="outline"
                        className="bg-red-100 text-xs text-red-700"
                      >
                        {g.lateRiskCount} at risk
                      </Badge>
                    )}
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order #</TableHead>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Items</TableHead>
                        <TableHead>Delivery</TableHead>
                        <TableHead>SE</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.rows.map((r) => (
                        <TableRow
                          key={r.orderId}
                          className={cn(
                            r.lateRisk &&
                              "bg-red-50/60 dark:bg-red-950/20"
                          )}
                        >
                          <TableCell className="font-mono text-xs">
                            <Link
                              href={`/orders/${r.orderId}`}
                              className="hover:underline"
                            >
                              {r.orderNo}
                            </Link>
                            {r.lateRisk && (
                              <Badge
                                variant="outline"
                                className="ml-1 bg-red-100 text-[10px] text-red-700"
                              >
                                ⚠ At risk
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{r.recipientName}</div>
                            <div className="font-mono text-xs text-muted-foreground">
                              {r.recipientPhone}
                            </div>
                          </TableCell>
                          <TableCell>
                            <ItemsCell items={r.items} />
                          </TableCell>
                          <TableCell>
                            <DeliveryModeBadge row={r} />
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {r.salesExecutive}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                r.status === "PACKED"
                                  ? "bg-violet-100 text-violet-800"
                                  : "bg-blue-100 text-blue-800"
                              }
                            >
                              {r.status === "PACKED" ? "Packed" : "Confirmed"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
