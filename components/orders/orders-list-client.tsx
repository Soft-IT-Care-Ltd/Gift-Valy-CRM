"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DateFilter } from "@/components/ui/date-filter";
import { detectPreset } from "@/lib/date-filter";
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
  recipientPhone: string;
  deliveryAddress: string;
  thana: string;
  codAmount: number;
  district: string;
  totalAmount: number;
  dueAmount: number;
  status: OrderStatusValue;
  salesExecutive: string;
  salesExecutiveId: number;
}

// Per-order result of a "Send to Steadfast" call (§2 step 3).
interface SendResult {
  orderId: number;
  orderNo: string;
  ok: boolean;
  skipped?: boolean;
  trackingCode?: string;
  consignmentId?: number;
  error?: string;
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
  canManageCourier,
  steadfastEnabled,
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
  canManageCourier: boolean; // courier.manage — may send to Steadfast
  steadfastEnabled: boolean; // integration on
}) {
  const router = useRouter();
  const params = useSearchParams();

  // ---- Send to Steadfast (§2): selection is offered only on the PACKED tab,
  // to a courier.manage user, when the integration is enabled. ----
  const activeStatus = params.get("status");
  const showSend =
    canManageCourier && steadfastEnabled && activeStatus === "PACKED";

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);

  // Selection is meaningful only within one page of PACKED orders — reset it
  // whenever the tab or page changes so stale ids never leak into a send. Done
  // during render (React's "reset state on prop change" pattern) rather than in
  // an effect, so it applies before paint without a cascading re-render.
  const selCtx = `${activeStatus}:${page}`;
  const [prevSelCtx, setPrevSelCtx] = useState(selCtx);
  if (prevSelCtx !== selCtx) {
    setPrevSelCtx(selCtx);
    setSelected(new Set());
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allOnPageSelected =
    orders.length > 0 && orders.every((o) => selected.has(o.id));
  function toggleAll() {
    setSelected((prev) => {
      if (orders.length > 0 && orders.every((o) => prev.has(o.id))) {
        const next = new Set(prev);
        orders.forEach((o) => next.delete(o.id));
        return next;
      }
      const next = new Set(prev);
      orders.forEach((o) => next.add(o.id));
      return next;
    });
  }

  const selectedOrders = orders.filter((o) => selected.has(o.id));

  async function sendToSteadfast() {
    if (selectedOrders.length === 0) return;
    setSending(true);
    setResults(null);
    const res = await fetch("/api/couriers/steadfast/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds: selectedOrders.map((o) => o.id) }),
    });
    setSending(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(data?.error ?? "Failed to send to Steadfast");
      return;
    }
    const rows = (data.results ?? []) as SendResult[];
    setResults(rows);
    const okCount = rows.filter((r) => r.ok).length;
    if (okCount > 0) {
      toast.success(`${okCount} order${okCount === 1 ? "" : "s"} sent to Steadfast`);
      setSelected(new Set());
      router.refresh();
    } else {
      toast.error("No orders were sent — see details");
    }
  }

  function closeSendDialog() {
    setConfirmOpen(false);
    setResults(null);
  }

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
          <DateFilter
            showAllTime
            value={
              rangeAll
                ? "all"
                : detectPreset(
                    params.get("from") ?? "",
                    params.get("to") ?? "",
                    "month" // list defaults to this month when no dates set
                  )
            }
            from={params.get("from") ?? ""}
            to={params.get("to") ?? ""}
            onApply={(preset, from, to) => {
              const next = new URLSearchParams(params.toString());
              next.delete("page");
              if (preset === "all") {
                next.set("range", "all");
                next.delete("from");
                next.delete("to");
              } else {
                next.delete("range");
                if (from) next.set("from", from);
                else next.delete("from");
                if (to) next.set("to", to);
                else next.delete("to");
              }
              router.push(`/orders?${next.toString()}`);
            }}
          />
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

        {/* Send to Steadfast bar — PACKED tab only (§2) */}
        {showSend && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
            <span className="text-sm text-muted-foreground">
              {selected.size > 0
                ? `${selected.size} order${selected.size === 1 ? "" : "s"} selected`
                : "Select packed orders to hand over via Steadfast."}
            </span>
            <Button
              size="sm"
              disabled={selected.size === 0}
              onClick={() => {
                setResults(null);
                setConfirmOpen(true);
              }}
            >
              Send to Steadfast{selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              {showSend && (
                <TableHead className="w-8">
                  <Checkbox
                    checked={allOnPageSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all on page"
                  />
                </TableHead>
              )}
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
                {showSend && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(o.id)}
                      onCheckedChange={() => toggleOne(o.id)}
                      aria-label={`Select ${o.orderNo}`}
                    />
                  </TableCell>
                )}
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
                  colSpan={showSend ? 10 : 9}
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

        {/* Send to Steadfast — confirm (§2) then per-order result table (§2 step 3) */}
        <Dialog open={confirmOpen} onOpenChange={(o) => !o && closeSendDialog()}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {results ? "Steadfast results" : "Send to Steadfast"}
              </DialogTitle>
              <DialogDescription>
                {results
                  ? "Orders that succeeded have moved to “Handed to courier”."
                  : `Review ${selectedOrders.length} order${
                      selectedOrders.length === 1 ? "" : "s"
                    } — a consignment is created for each and the order is handed over.`}
              </DialogDescription>
            </DialogHeader>

            {!results ? (
              <div className="max-h-[50vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Phone (BD)</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead className="text-right">COD</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedOrders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="font-mono text-xs">{o.orderNo}</TableCell>
                        <TableCell>{o.recipientName}</TableCell>
                        <TableCell className="font-mono text-xs">{o.recipientPhone}</TableCell>
                        <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                          {o.deliveryAddress}, {o.thana}, {o.district}
                        </TableCell>
                        <TableCell className="text-right">{money(o.codAmount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="max-h-[50vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => (
                      <TableRow key={r.orderId}>
                        <TableCell className="font-mono text-xs">{r.orderNo}</TableCell>
                        <TableCell>
                          {r.ok ? (
                            <Badge className="bg-green-100 text-green-800">✓ Sent</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-red-100 text-red-800">
                              ✗ {r.skipped ? "Skipped" : "Failed"}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.ok
                            ? `Tracking ${r.trackingCode ?? r.consignmentId}`
                            : r.error}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <DialogFooter>
              {!results ? (
                <>
                  <Button variant="outline" onClick={closeSendDialog} disabled={sending}>
                    Cancel
                  </Button>
                  <Button
                    onClick={sendToSteadfast}
                    disabled={sending || selectedOrders.length === 0}
                  >
                    {sending
                      ? "Sending…"
                      : `Confirm & send ${selectedOrders.length}`}
                  </Button>
                </>
              ) : (
                <Button onClick={closeSendDialog}>Close</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
