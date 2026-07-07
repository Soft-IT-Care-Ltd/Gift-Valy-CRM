"use client";

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
import { money, formatDate } from "@/lib/format";
import {
  ORDER_STATUSES,
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

export function OrdersListClient({
  orders,
  seOptions,
  canCreate,
}: {
  orders: OrderRow[];
  seOptions: { id: number; name: string }[]; // empty for own-only scope
  canCreate: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value && value !== "ALL") next.set(key, value);
    else next.delete(key);
    router.push(`/orders?${next.toString()}`);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Orders</CardTitle>
          <CardDescription>
            {orders.length} order{orders.length === 1 ? "" : "s"} in view
          </CardDescription>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/orders/new">New order</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">Status</Label>
            <Select
              value={params.get("status") ?? "ALL"}
              onValueChange={(v) => setParam("status", v)}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {ORDER_STATUSES.filter(
                  (s) => s !== "LEAD" && s !== "FOLLOW_UP"
                ).map((s) => (
                  <SelectItem key={s} value={s}>
                    {ORDER_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            params.get("seId")) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/orders")}
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
      </CardContent>
    </Card>
  );
}
