"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { money, formatDate } from "@/lib/format";
import {
  ORDER_STATUS_LABELS,
  type OrderStatusValue,
} from "@/lib/order-constants";

export interface OrderRow {
  id: number;
  orderNo: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  customerCountry: string;
  recipientName: string;
  district: string;
  totalAmount: number;
  dueAmount: number;
  status: OrderStatusValue;
  salesExecutive: string;
  salesExecutiveId: number;
}

const STATUS_BADGE: Partial<Record<OrderStatusValue, string>> = {
  CONFIRMED: "bg-blue-100 text-blue-800",
  PACKED: "bg-violet-100 text-violet-800",
  HANDED_TO_COURIER: "bg-amber-100 text-amber-800",
  IN_TRANSIT: "bg-amber-100 text-amber-800",
  DELIVERED: "bg-green-100 text-green-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  ON_HOLD: "bg-slate-200 text-slate-800",
  CANCELLED: "bg-red-100 text-red-800",
  RETURNED: "bg-orange-100 text-orange-800",
  REFUNDED: "bg-rose-100 text-rose-800",
};

export function StatusBadge({ status }: { status: OrderStatusValue }) {
  return (
    <Badge variant="outline" className={STATUS_BADGE[status]}>
      {ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}

// Tab order mirrors the §1.3 lifecycle, side states last. LEAD/FOLLOW_UP are
// pre-order stages (Leads module) and never appear here.
const STATUS_TABS: OrderStatusValue[] = [
  "CONFIRMED",
  "PACKED",
  "HANDED_TO_COURIER",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
  "ON_HOLD",
  "CANCELLED",
  "RETURNED",
  "REFUNDED",
];

export function OrdersListClient({
  orders,
  statusCounts,
  total,
  page,
  pageSize,
  q,
  rangeAll,
  seOptions,
  canCreate,
}: {
  orders: OrderRow[];
  statusCounts: Partial<Record<OrderStatusValue, number>>; // for current window/search/SE
  total: number; // active tab's count — drives pagination
  page: number;
  pageSize: number;
  q: string;
  rangeAll: boolean;
  seOptions: { id: number; name: string }[]; // empty for own-only scope
  canCreate: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

  // Any filter change restarts at page 1 — a page number only means something
  // within the result set it was computed for.
  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value && value !== "ALL") next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    router.push(`/orders?${next.toString()}`);
  }

  // Debounced search — order no, customer name, either phone number.
  const [search, setSearch] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim() !== q) setParam("q", search.trim());
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const hasExplicitDates = !!params.get("from") || !!params.get("to");
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Orders</CardTitle>
          <CardDescription>
            {total} order{total === 1 ? "" : "s"}
            {q
              ? " matching your search (all time)"
              : rangeAll || hasExplicitDates
                ? " in the selected range"
                : " this month"}
          </CardDescription>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/orders/new">New order</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* Status tabs — counts follow the active date/SE filters */}
        <div className="flex flex-wrap gap-1 border-b pb-2">
          {(() => {
            const active = params.get("status") ?? "ALL";
            const total = STATUS_TABS.reduce(
              (s, t) => s + (statusCounts[t] ?? 0),
              0
            );
            const tab = (value: string, label: string, count: number) => (
              <button
                key={value}
                onClick={() => setParam("status", value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {label}
                <span
                  className={cn(
                    "ml-1.5 text-xs",
                    active === value
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground/70"
                  )}
                >
                  {count}
                </span>
              </button>
            );
            return [
              tab("ALL", "All", total),
              ...STATUS_TABS.map((s) =>
                tab(s, ORDER_STATUS_LABELS[s], statusCounts[s] ?? 0)
              ),
            ];
          })()}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">Search</Label>
            <Input
              className="w-56"
              placeholder="Order #, phone, customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Range</Label>
            <div className="flex gap-1">
              <Button
                variant={
                  !rangeAll && !hasExplicitDates && !q ? "default" : "outline"
                }
                size="sm"
                onClick={() => {
                  const next = new URLSearchParams(params.toString());
                  ["range", "from", "to", "page"].forEach((k) => next.delete(k));
                  router.push(`/orders?${next.toString()}`);
                }}
              >
                This month
              </Button>
              <Button
                variant={rangeAll && !q ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  const next = new URLSearchParams(params.toString());
                  next.set("range", "all");
                  ["from", "to", "page"].forEach((k) => next.delete(k));
                  router.push(`/orders?${next.toString()}`);
                }}
              >
                All time
              </Button>
            </div>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              className="w-40"
              value={params.get("from") ?? ""}
              onChange={(e) => setParam("from", e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              className="w-40"
              value={params.get("to") ?? ""}
              onChange={(e) => setParam("to", e.target.value)}
            />
          </div>
          {seOptions.length > 0 && (
            <div className="grid gap-1">
              <Label className="text-xs">Sales Executive</Label>
              <Select
                value={params.get("seId") ?? "ALL"}
                onValueChange={(v) => setParam("seId", v)}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All SEs</SelectItem>
                  {seOptions.map((se) => (
                    <SelectItem key={se.id} value={String(se.id)}>
                      {se.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {(params.get("status") ||
            params.get("from") ||
            params.get("to") ||
            params.get("seId") ||
            params.get("q") ||
            params.get("range") ||
            params.get("page")) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                router.push("/orders");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>District</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>SE</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow
                key={o.id}
                className="cursor-pointer"
                onClick={() => router.push(`/orders/${o.id}`)}
              >
                <TableCell className="font-mono text-xs">
                  <Link
                    href={`/orders/${o.id}`}
                    className="hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {o.orderNo}
                  </Link>
                </TableCell>
                <TableCell>{formatDate(o.createdAt)}</TableCell>
                <TableCell>
                  <div className="font-medium">{o.customerName}</div>
                  <div className="text-xs text-muted-foreground">
                    {o.customerCountry}
                  </div>
                </TableCell>
                <TableCell>{o.recipientName}</TableCell>
                <TableCell>{o.district}</TableCell>
                <TableCell className="text-right">
                  {money(o.totalAmount)}
                </TableCell>
                <TableCell className="text-right">
                  {o.dueAmount > 0 ? (
                    <span className="text-amber-700">{money(o.dueAmount)}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={o.status} />
                </TableCell>
                <TableCell>{o.salesExecutive}</TableCell>
              </TableRow>
            ))}
            {orders.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center text-muted-foreground"
                >
                  No orders match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm text-muted-foreground">
          <span>
            {total === 0
              ? "No orders"
              : `Showing ${from}–${to} of ${total}`}
          </span>
          {lastPage > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setParam("page", String(page - 1))}
              >
                ← Prev
              </Button>
              <span>
                Page {page} of {lastPage}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= lastPage}
                onClick={() => setParam("page", String(page + 1))}
              >
                Next →
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
