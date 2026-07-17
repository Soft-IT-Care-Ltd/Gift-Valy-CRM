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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ArchiveRestore,
  ChevronDown,
  Eye,
  NotebookPen,
  PackageCheck,
  Pencil,
  Printer,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DateFilter } from "@/components/ui/date-filter";
import { detectPreset } from "@/lib/date-filter";
import { money, formatDate } from "@/lib/format";
import {
  ALLOWED_TRANSITIONS,
  DELIVERY_ZONES,
  DELIVERY_ZONE_LABELS,
  EDITABLE_STATUSES,
  ORDER_STATUS_LABELS,
  TRASHABLE_STATUSES,
  joinAddress,
  type DeliveryDateModeValue,
  type DeliveryZoneValue,
  type OrderStatusValue,
} from "@/lib/order-constants";
import {
  COURIER_STAGE_STATUSES,
  COURIER_STATUSES,
  COURIER_STATUS_LABELS,
  estimateCourierCost,
  type CourierStatusValue,
  type ZoneRate,
} from "@/lib/courier-constants";
import {
  ReturnReceiveDialog,
  type ReceiveTarget,
} from "@/components/orders/return-receive-dialog";

// Shipment columns on the courier-stage tabs (CORRECTIONS Orders §6k/§6l).
// steadfastDeliveryCharge / courierCostEstimated are COST fields — the server
// omits them for cost-blind roles (they are optional here).
export interface ShipmentInfo {
  id: number;
  consignmentId: number | null;
  trackingNo: string | null;
  trackingUrl: string | null;
  weightKg: number | null; // our recorded weight (BOM sum, editable at handover)
  steadfastWeightKg: number | null; // what Steadfast counted
  steadfastStatus: string | null;
  // §6m — In Transit sub-state + rider; null renders Pending / "Unassigned".
  courierStatus: CourierStatusValue | null;
  riderName: string | null;
  riderPhone: string | null;
  // §6n — set once the Packaging team received + inspected the return.
  returnReceivedAt: string | null;
  steadfastDeliveryCharge?: number | null; // actual charge (webhook/API)
  courierCostEstimated?: number | null; // zone+weight estimate
}

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
  deliveryDateMode: DeliveryDateModeValue;
  requestedDeliveryDate: string | null;
  draftAge: string | null; // "6h" / "2d 4h" — DRAFT rows only
  draftOverdue: boolean; // DRAFT unpaid > 24h — chase it
  notes: string | null;
  invoiceNote: string | null;
  courierNote: string | null;
  // Items column (§6c) — resolved item names + qty
  items: { id: number; name: string; qty: number }[];
  // Trash (§6f) — set only on the Trash tab
  deletedAt: string | null;
  purgeInDays: number | null;
  salesExecutive: string;
  salesExecutiveId: number;
  shipment: ShipmentInfo | null;
}

// Per-order zone/weight state in the Send-to-Steadfast dialog (§1 estimates).
interface SendEstimate {
  zone: DeliveryZoneValue | "";
  weightKg: string;
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
  DRAFT: "bg-slate-100 text-slate-700 border-dashed",
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

// §6m — Courier Status badges on the In Transit tab. A shipment with no
// sub-state yet renders as Pending (warehouse-received is the entry state).
const COURIER_STATUS_BADGE: Record<CourierStatusValue, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  ASSIGNED: "bg-blue-100 text-blue-800",
  DELIVERY_APPROVAL_PENDING: "bg-violet-100 text-violet-800",
  RETURN_APPROVAL_PENDING: "bg-orange-100 text-orange-800",
};

function CourierStatusBadge({
  status,
}: {
  status: CourierStatusValue | null;
}) {
  const s = status ?? "PENDING";
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", COURIER_STATUS_BADGE[s])}>
      {COURIER_STATUS_LABELS[s]}
    </Badge>
  );
}

// Tab order mirrors the §1.3 lifecycle, side states last. LEAD/FOLLOW_UP are
// pre-order stages (Leads module) and never appear here. DRAFT leads the row —
// the "Pending Payment (Drafts)" pipeline (CORRECTIONS Leads §10).
const STATUS_TABS: OrderStatusValue[] = [
  "DRAFT",
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

// Tab labels — DRAFT reads as what it is: the committed-but-unpaid queue.
const STATUS_TAB_LABELS: Partial<Record<OrderStatusValue, string>> = {
  DRAFT: "Pending Payment (Drafts)",
};

export function OrdersListClient({
  orders,
  statusCounts,
  transitSubCounts,
  returnedSubCounts,
  trashCount,
  total,
  page,
  pageSize,
  q,
  rangeAll,
  seOptions,
  canCreate,
  canManageCourier,
  steadfastEnabled,
  canTrash,
  canEditOrders,
  canCancelOrders,
  canPackOrders,
  canPrintInvoices,
  canSeeCosts,
}: {
  orders: OrderRow[];
  statusCounts: Partial<Record<OrderStatusValue, number>>; // for current window/search/SE
  // §6m — In Transit sub-tab counts (null off the In Transit tab)
  transitSubCounts: Record<CourierStatusValue, number> | null;
  // §6n — Returned sub-tab counts (null off the Returned tab)
  returnedSubCounts: { pending: number; received: number } | null;
  trashCount: number; // trashed orders in scope (§6f)
  total: number; // active tab's count — drives pagination
  page: number;
  pageSize: number;
  q: string;
  rangeAll: boolean;
  seOptions: { id: number; name: string }[]; // empty for own-only scope
  canCreate: boolean;
  canManageCourier: boolean; // courier.manage — may send to Steadfast
  steadfastEnabled: boolean; // integration on
  canTrash: boolean; // orders.trash — trash/restore + sees the Trash tab (§6e/§6f)
  canEditOrders: boolean; // orders.edit
  canCancelOrders: boolean; // orders.cancel
  canPackOrders: boolean; // orders.pack
  canPrintInvoices: boolean; // invoice.generate — bulk print (§6h)
  canSeeCosts: boolean; // cost-visible roles see the SF Delivery Charge column (§6l)
}) {
  const router = useRouter();
  const params = useSearchParams();

  const activeStatus = params.get("status");
  const isTrashTab = activeStatus === "TRASH";

  // ---- Inline status change (§6g): which targets may THIS user move an
  // order to, mirroring statusChangePermitted (lib/orders.ts) + the detail
  // page's rule that courier-stage moves only happen through a shipment. ----
  function eligibleTargets(from: OrderStatusValue): OrderStatusValue[] {
    return ALLOWED_TRANSITIONS[from].filter((to) => {
      if (COURIER_STAGE_STATUSES.includes(to)) return false;
      if (to === "PACKED") return canPackOrders || canEditOrders;
      if (to === "CANCELLED") return canCancelOrders;
      return canEditOrders;
    });
  }

  // Sub-tabs (§6m/§6n): In Transit filters by courier status; Returned splits
  // Pending (parcel on its way back) / Received (inspected — default Pending).
  const isReturnedTab = activeStatus === "RETURNED";
  const transitSub = COURIER_STATUSES.includes(
    params.get("sub") as CourierStatusValue
  )
    ? (params.get("sub") as CourierStatusValue)
    : null;
  const returnedSub: "pending" | "received" =
    params.get("sub") === "received" ? "received" : "pending";
  // §6n — Packaging receives pending returns (single or multi-select).
  const showReceive =
    canPackOrders && isReturnedTab && returnedSub === "pending";

  // ---- Selection: any specific status tab offers checkboxes when at least
  // one bulk action applies (§6g/§6h + Steadfast §2). All orders on one tab
  // share a status, so the §6g "intersection of eligible statuses" is simply
  // the tab status's eligible set. ----
  const tabStatus = STATUS_TABS.includes(activeStatus as OrderStatusValue)
    ? (activeStatus as OrderStatusValue)
    : null;
  const bulkTargets = tabStatus ? eligibleTargets(tabStatus) : [];
  // §6j — Send to Steadfast from the CONFIRMED tab too; a confirmed order
  // auto-packs (stock deduction + cost snapshot) on its way out.
  const showSend =
    canManageCourier &&
    steadfastEnabled &&
    (activeStatus === "PACKED" || activeStatus === "CONFIRMED");
  const showPrint =
    canPrintInvoices &&
    (activeStatus === "CONFIRMED" || activeStatus === "PACKED");
  const showCheckboxes =
    !!tabStatus &&
    (bulkTargets.length > 0 || showSend || showPrint || showReceive);

  // Courier-stage tab columns (§6k/§6l).
  const isHandedTab = activeStatus === "HANDED_TO_COURIER";
  const isTransitTab = activeStatus === "IN_TRANSIT";
  const showCourierCols = isHandedTab || isTransitTab;
  const showChargeCol = isTransitTab && canSeeCosts;

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);

  // §1 — per-order zone/weight estimates in the send dialog, pre-filled by
  // /api/couriers/steadfast/estimate (BOM weight + order zone) and editable.
  const [estimates, setEstimates] = useState<Record<number, SendEstimate>>({});
  const [zoneRates, setZoneRates] = useState<ZoneRate[]>([]);

  function estimateFor(orderId: number): number | null {
    const e = estimates[orderId];
    if (!e || !e.zone) return null;
    const rate = zoneRates.find((r) => r.zone === e.zone);
    const weight = e.weightKg === "" ? null : Number(e.weightKg);
    return estimateCourierCost(
      rate ?? null,
      weight != null && Number.isFinite(weight) ? weight : null
    );
  }

  async function openSendDialog() {
    setResults(null);
    setConfirmOpen(true);
    setEstimates({});
    const res = await fetch("/api/couriers/steadfast/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds: selectedOrders.map((o) => o.id) }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return; // dialog still works — just no prefill
    setZoneRates((data.rates ?? []) as ZoneRate[]);
    const next: Record<number, SendEstimate> = {};
    for (const row of data.rows ?? []) {
      next[row.orderId] = {
        zone: (row.zone ?? "") as SendEstimate["zone"],
        weightKg: row.weightKg != null ? String(row.weightKg) : "",
      };
    }
    setEstimates(next);
  }

  // Selection is meaningful only within one page of one tab — reset it
  // whenever the tab, sub-tab or page changes so stale ids never leak into a
  // send/receive. Done during render (React's "reset state on prop change"
  // pattern) rather than in an effect, so it applies before paint without a
  // cascading re-render.
  const selCtx = `${activeStatus}:${params.get("sub") ?? ""}:${page}`;
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
    // §1 — the dialog's zone/weight picks ride along so the shipment records
    // the courier cost estimate.
    const overrides = selectedOrders.map((o) => {
      const e = estimates[o.id];
      const weight = e && e.weightKg !== "" ? Number(e.weightKg) : null;
      return {
        orderId: o.id,
        deliveryZone: e?.zone ? e.zone : null,
        weightKg:
          weight != null && Number.isFinite(weight) && weight >= 0
            ? weight
            : null,
      };
    });
    const res = await fetch("/api/couriers/steadfast/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderIds: selectedOrders.map((o) => o.id),
        overrides,
      }),
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

  // ---- Bulk invoice print (§6h): one PDF, two half-A4 invoices per page (§6i) ----
  const [printing, setPrinting] = useState(false);

  async function printInvoices() {
    if (selectedOrders.length === 0 || printing) return;
    setPrinting(true);
    try {
      const res = await fetch("/api/orders/print-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: selectedOrders.map((o) => o.id) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Failed to build the print job");
        return;
      }
      const skipped = Number(res.headers.get("X-Skipped-Count") ?? 0);
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank");
      const count = selectedOrders.length - skipped;
      toast.success(
        `Print job ready — ${count} invoice${count === 1 ? "" : "s"} on ${Math.ceil(count / 2)} A4 page${count > 2 ? "s" : ""}`
      );
      if (skipped > 0) {
        toast.warning(`${skipped} selected order${skipped === 1 ? "" : "s"} had nothing to print`);
      }
    } finally {
      setPrinting(false);
    }
  }

  // ---- Status change (§6g): single (row dropdown) and bulk share one dialog ----
  interface StatusChange {
    orders: OrderRow[]; // 1 = single, >1 = bulk
    to: OrderStatusValue;
  }
  const [statusChange, setStatusChange] = useState<StatusChange | null>(null);
  const [statusNote, setStatusNote] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusResults, setStatusResults] = useState<
    { orderNo: string; ok: boolean; error?: string }[] | null
  >(null);

  function openStatusChange(orders: OrderRow[], to: OrderStatusValue) {
    setStatusChange({ orders, to });
    setStatusNote("");
    setStatusResults(null);
  }

  // Each order goes through the SAME endpoint the detail page uses, so every
  // side effect (stock reserve/deduct/release, history, draft-confirm,
  // invoice v1) fires identically (§6g).
  async function applyStatusChange() {
    if (!statusChange || statusBusy) return;
    setStatusBusy(true);
    try {
      const outcomes: { orderNo: string; ok: boolean; error?: string }[] = [];
      for (const o of statusChange.orders) {
        const res = await fetch(`/api/orders/${o.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: statusChange.to,
            note: statusNote.trim() || null,
          }),
        });
        const data = await res.json().catch(() => null);
        outcomes.push({
          orderNo: o.orderNo,
          ok: res.ok,
          error: res.ok ? undefined : (data?.error ?? "Failed"),
        });
      }
      const okCount = outcomes.filter((r) => r.ok).length;
      if (okCount > 0) {
        toast.success(
          `${okCount} order${okCount === 1 ? "" : "s"} moved to ${ORDER_STATUS_LABELS[statusChange.to]}`
        );
        setSelected(new Set());
        router.refresh();
      }
      if (okCount === statusChange.orders.length) {
        setStatusChange(null);
      } else {
        setStatusResults(outcomes); // keep the dialog open to show failures
        if (okCount === 0) toast.error("No orders were moved — see details");
      }
    } finally {
      setStatusBusy(false);
    }
  }

  // ---- Return receive + damage inspection (§6n) ----
  const [receiveTargets, setReceiveTargets] = useState<ReceiveTarget[] | null>(
    null
  );

  function openReceive(rows: OrderRow[]) {
    const targets = rows
      .filter((o) => o.shipment && !o.shipment.returnReceivedAt)
      .map((o) => ({
        orderId: o.id,
        orderNo: o.orderNo,
        shipmentId: o.shipment!.id,
      }));
    if (targets.length === 0) {
      toast.error("No receivable returns selected (each needs a courier shipment)");
      return;
    }
    setReceiveTargets(targets);
  }

  // ---- Trash / restore (§6e/§6f) ----
  const [trashOrder, setTrashOrder] = useState<OrderRow | null>(null);
  const [trashBusy, setTrashBusy] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  async function confirmTrash() {
    if (!trashOrder || trashBusy) return;
    setTrashBusy(true);
    try {
      const res = await fetch(`/api/orders/${trashOrder.id}/trash`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Failed to trash the order");
        return;
      }
      toast.success(
        `${trashOrder.orderNo} moved to Trash — restorable for 30 days`
      );
      setTrashOrder(null);
      router.refresh();
    } finally {
      setTrashBusy(false);
    }
  }

  async function restoreOrder(o: OrderRow) {
    if (restoringId) return;
    setRestoringId(o.id);
    try {
      const res = await fetch(`/api/orders/${o.id}/restore`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Failed to restore the order");
        return;
      }
      toast.success(`${o.orderNo} restored`);
      router.refresh();
    } finally {
      setRestoringId(null);
    }
  }

  // ---- Items dialog (§6c): the "+N more" chip opens the full list ----
  const [itemsOrder, setItemsOrder] = useState<OrderRow | null>(null);

  // ---- Note modal (CORRECTIONS Orders §6d): view + update the 3 notes ----
  const [noteOrder, setNoteOrder] = useState<OrderRow | null>(null);
  const [noteTab, setNoteTab] = useState<"order" | "invoice" | "courier">("order");
  const [noteDraft, setNoteDraft] = useState({ order: "", invoice: "", courier: "" });
  const [noteSaving, setNoteSaving] = useState(false);

  function openNotes(o: OrderRow) {
    setNoteOrder(o);
    setNoteTab("order");
    setNoteDraft({
      order: o.notes ?? "",
      invoice: o.invoiceNote ?? "",
      courier: o.courierNote ?? "",
    });
  }

  async function saveNotes() {
    if (!noteOrder) return;
    setNoteSaving(true);
    const res = await fetch(`/api/orders/${noteOrder.id}/notes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notes: noteDraft.order || null,
        invoiceNote: noteDraft.invoice || null,
        courierNote: noteDraft.courier || null,
      }),
    });
    setNoteSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to update notes");
      return;
    }
    toast.success(`Notes updated — ${noteOrder.orderNo}`);
    setNoteOrder(null);
    router.refresh();
  }

  // Any filter change restarts at page 1 — a page number only means something
  // within the result set it was computed for.
  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value && value !== "ALL") next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    // A sub-tab (§6m/§6n) only means something within its own status tab.
    if (key === "status") next.delete("sub");
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

  const colCount =
    (showCheckboxes ? 1 : 0) +
    11 +
    (isTransitTab ? -1 : 0) + // order-status column removed on In Transit (§6m)
    (showCourierCols ? 2 : 0) + // Consignment ID + Tracking (§6k)
    (isTransitTab ? 2 : 0) + // Courier Status + Rider Info (§6m)
    (isTransitTab ? 1 : 0) + // Steadfast Weight (§6l)
    (showChargeCol ? 1 : 0) + // Steadfast Delivery Charge — cost-visible only
    (isReturnedTab ? 1 : 0); // Return column (§6n)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Orders</CardTitle>
          <CardDescription>
            {total} order{total === 1 ? "" : "s"}
            {isTrashTab
              ? " in the trash"
              : q
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
            const active = activeStatus ?? "ALL";
            const allCount = STATUS_TABS.reduce(
              (s, t) => s + (statusCounts[t] ?? 0),
              0
            );
            const tab = (
              value: string,
              label: string,
              count: number,
              extraClass?: string
            ) => (
              <button
                key={value}
                onClick={() => setParam("status", value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  extraClass
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
              tab("ALL", "All", allCount),
              ...STATUS_TABS.map((s) =>
                tab(
                  s,
                  STATUS_TAB_LABELS[s] ?? ORDER_STATUS_LABELS[s],
                  statusCounts[s] ?? 0
                )
              ),
              // Trash tab (§6f) — only for orders.trash holders
              ...(canTrash
                ? [
                    tab(
                      "TRASH",
                      "Trash",
                      trashCount,
                      active === "TRASH"
                        ? "bg-destructive text-white"
                        : "text-destructive/80 hover:text-destructive"
                    ),
                  ]
                : []),
            ];
          })()}
        </div>

        {/* In Transit sub-tabs (§6m) — the 4 courier statuses with counts */}
        {isTransitTab && transitSubCounts && (
          <div className="flex flex-wrap gap-1 rounded-md bg-muted p-1">
            {(() => {
              const subTab = (
                value: CourierStatusValue | null,
                label: string,
                count: number
              ) => {
                const active = transitSub === value;
                return (
                  <button
                    key={value ?? "ALL"}
                    onClick={() => setParam("sub", value ?? "ALL")}
                    className={cn(
                      "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                      active
                        ? "bg-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                    <span className="ml-1 text-muted-foreground/80">{count}</span>
                  </button>
                );
              };
              const all = COURIER_STATUSES.reduce(
                (s, c) => s + transitSubCounts[c],
                0
              );
              return [
                subTab(null, "All", all),
                ...COURIER_STATUSES.map((c) =>
                  subTab(c, COURIER_STATUS_LABELS[c], transitSubCounts[c])
                ),
              ];
            })()}
          </div>
        )}

        {/* Returned sub-tabs (§6n) — Pending (on its way back) / Received */}
        {isReturnedTab && returnedSubCounts && (
          <div className="flex flex-wrap gap-1 rounded-md bg-muted p-1">
            {(
              [
                ["pending", "Pending", returnedSubCounts.pending],
                ["received", "Received", returnedSubCounts.received],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                onClick={() => setParam("sub", value === "pending" ? "ALL" : value)}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                  returnedSub === value
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
                <span className="ml-1 text-muted-foreground/80">{count}</span>
              </button>
            ))}
          </div>
        )}

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
          {!isTrashTab && (
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
          )}
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

        {/* Pending Payment (Drafts) helper — CORRECTIONS Leads §10 */}
        {activeStatus === "DRAFT" && (
          <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
            Committed-but-unpaid orders. No stock is reserved and nothing counts
            as a sale yet — recording the advance payment on a draft confirms
            it (real order number, stock reserve, invoice). Rows older than 24
            hours show in red: chase them.
          </div>
        )}

        {/* Returned Pending helper — CORRECTIONS Orders §6n */}
        {isReturnedTab && returnedSub === "pending" && (
          <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300">
            These parcels are on their way back — no stock has changed yet. When
            a parcel physically arrives, mark it Received: the inspection dialog
            puts OK items straight back into sellable stock and logs damaged
            items (with their cost counted as a loss). No separate approval step.
          </div>
        )}

        {/* Trash helper — CORRECTIONS Orders §6f */}
        {isTrashTab && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            Trashed orders are excluded from every list, report and stock
            reservation. Each order is deleted permanently 30 days after it was
            trashed — restore it before the countdown ends to bring it back
            (a confirmed order re-reserves its stock on restore).
          </div>
        )}

        {/* Bulk action bar — status change (§6g), invoice print (§6h), Steadfast (§2) */}
        {showCheckboxes && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
            <span className="text-sm text-muted-foreground">
              {selected.size > 0
                ? `${selected.size} order${selected.size === 1 ? "" : "s"} selected`
                : "Select orders for bulk actions."}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {bulkTargets.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" disabled={selected.size === 0}>
                      Change status
                      <ChevronDown className="ml-1 size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>
                      Move {selected.size} order{selected.size === 1 ? "" : "s"} to
                    </DropdownMenuLabel>
                    {bulkTargets.map((to) => (
                      <DropdownMenuItem
                        key={to}
                        onClick={() => openStatusChange(selectedOrders, to)}
                      >
                        {ORDER_STATUS_LABELS[to]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {showPrint && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selected.size === 0 || printing}
                  onClick={printInvoices}
                >
                  <Printer className="mr-1 size-3.5" />
                  {printing
                    ? "Preparing…"
                    : `Print invoices${selected.size > 0 ? ` (${selected.size})` : ""}`}
                </Button>
              )}
              {showSend && (
                <Button
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={openSendDialog}
                >
                  Send to Steadfast{selected.size > 0 ? ` (${selected.size})` : ""}
                </Button>
              )}
              {showReceive && (
                <Button
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => openReceive(selectedOrders)}
                >
                  <PackageCheck className="mr-1 size-3.5" />
                  Mark received{selected.size > 0 ? ` (${selected.size})` : ""}
                </Button>
              )}
            </div>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              {showCheckboxes && (
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
              <TableHead>Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Due</TableHead>
              {/* §6m: the In Transit tab swaps the order-status column for
                  Courier Status + Rider Info */}
              {!isTransitTab && <TableHead>Status</TableHead>}
              {isTransitTab && <TableHead>Courier Status</TableHead>}
              {isTransitTab && <TableHead>Rider Info</TableHead>}
              {/* Courier-stage columns (§6k/§6l) */}
              {showCourierCols && <TableHead>Consignment ID</TableHead>}
              {showCourierCols && <TableHead>Tracking</TableHead>}
              {showChargeCol && (
                <TableHead className="text-right">SF Charge</TableHead>
              )}
              {isTransitTab && (
                <TableHead className="text-right">Weight</TableHead>
              )}
              {/* §6n: Returned sub-state + receive action */}
              {isReturnedTab && <TableHead>Return</TableHead>}
              <TableHead>Note</TableHead>
              <TableHead>SE</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => {
              const hasNote = !!(o.notes || o.invoiceNote || o.courierNote);
              const rowTargets = isTrashTab ? [] : eligibleTargets(o.status);
              const itemsTitle = o.items
                .map((it) => `${it.qty}× ${it.name}`)
                .join(", ");
              return (
              <TableRow
                key={o.id}
                className={cn(!isTrashTab && "cursor-pointer")}
                onClick={
                  isTrashTab ? undefined : () => router.push(`/orders/${o.id}`)
                }
              >
                {showCheckboxes && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(o.id)}
                      onCheckedChange={() => toggleOne(o.id)}
                      aria-label={`Select ${o.orderNo}`}
                    />
                  </TableCell>
                )}
                <TableCell className="font-mono text-xs">
                  {isTrashTab ? (
                    o.orderNo
                  ) : (
                    <Link
                      href={`/orders/${o.id}`}
                      className="hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {o.orderNo}
                    </Link>
                  )}
                </TableCell>
                <TableCell>
                  {formatDate(o.createdAt)}
                  {/* Pending-Payment aging (§10) — red after 24h unpaid */}
                  {!isTrashTab && o.status === "DRAFT" && o.draftAge && (
                    <div
                      className={cn(
                        "text-xs",
                        o.draftOverdue
                          ? "font-medium text-destructive"
                          : "text-muted-foreground"
                      )}
                    >
                      unpaid {o.draftAge}
                    </div>
                  )}
                  {/* Purge countdown (§6f) */}
                  {isTrashTab && o.purgeInDays != null && (
                    <div
                      className={cn(
                        "text-xs font-medium",
                        o.purgeInDays <= 5
                          ? "text-destructive"
                          : "text-muted-foreground"
                      )}
                    >
                      deletes in {o.purgeInDays}d
                    </div>
                  )}
                </TableCell>
                {/* Customer (§6a): Name → Phone → Country */}
                <TableCell>
                  <div className="font-medium">{o.customerName}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {o.customerPhone}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {o.customerCountry}
                  </div>
                </TableCell>
                {/* Recipient (§6b): phone below the name */}
                <TableCell>
                  {o.recipientName}
                  <div className="font-mono text-xs text-muted-foreground">
                    {o.recipientPhone}
                  </div>
                  {o.deliveryDateMode === "FIXED" && o.requestedDeliveryDate && (
                    <div className="text-xs font-medium text-violet-700 dark:text-violet-400">
                      🎯 {formatDate(o.requestedDeliveryDate)}
                    </div>
                  )}
                  {o.deliveryDateMode === "ASAP" && (
                    <div className="text-xs font-medium text-amber-700 dark:text-amber-500">
                      ⚡ ASAP
                    </div>
                  )}
                </TableCell>
                {/* Items (§6c): first 3 items STACKED like the Customer column
                    (one per line — side-by-side badges ate too much width);
                    anything past the 3rd lives in the "+N more" modal / order
                    detail only. Each line truncates so the row never grows. */}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="max-w-[170px]" title={itemsTitle}>
                    {o.items.length === 0 && (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {o.items.slice(0, 3).map((it) => (
                      <div key={it.id} className="truncate text-xs">
                        {it.qty > 1 && (
                          <span className="text-muted-foreground">{it.qty}× </span>
                        )}
                        {it.name}
                      </div>
                    ))}
                    {o.items.length > 3 && (
                      <button
                        type="button"
                        onClick={() => setItemsOrder(o)}
                        className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                      >
                        +{o.items.length - 3} more
                      </button>
                    )}
                  </div>
                </TableCell>
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
                {/* Status (§6g): dropdown of eligible-only targets, straight
                    from the list — same endpoint/side effects as the detail
                    page. Hidden on the In Transit tab (§6m: courier owns it). */}
                {!isTransitTab && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {rowTargets.length > 0 ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger className="group flex items-center gap-0.5 rounded-md outline-none">
                        <StatusBadge status={o.status} />
                        <ChevronDown className="size-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuLabel className="text-xs">
                          Move {o.orderNo} to
                        </DropdownMenuLabel>
                        {rowTargets.map((to) => (
                          <DropdownMenuItem
                            key={to}
                            disabled={to === "COMPLETED" && o.dueAmount !== 0}
                            onClick={() => openStatusChange([o], to)}
                          >
                            {ORDER_STATUS_LABELS[to]}
                            {to === "COMPLETED" && o.dueAmount !== 0 && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                (due must be 0)
                              </span>
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <StatusBadge status={o.status} />
                  )}
                </TableCell>
                )}
                {/* Courier Status (§6m) — the 4-value sub-state */}
                {isTransitTab && (
                  <TableCell>
                    <CourierStatusBadge status={o.shipment?.courierStatus ?? null} />
                  </TableCell>
                )}
                {/* Rider Info (§6m) — "Unassigned" until Steadfast assigns */}
                {isTransitTab && (
                  <TableCell>
                    {o.shipment?.riderName ? (
                      <>
                        <div className="text-sm">{o.shipment.riderName}</div>
                        {o.shipment.riderPhone && (
                          <div className="font-mono text-xs text-muted-foreground">
                            {o.shipment.riderPhone}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Unassigned
                      </span>
                    )}
                  </TableCell>
                )}
                {/* Consignment ID + Tracking Link (§6k) — auto-filled after the
                    Steadfast API entry; "—" for manual/unbooked shipments */}
                {showCourierCols && (
                  <TableCell className="font-mono text-xs">
                    {o.shipment?.consignmentId ?? (
                      <span className="font-sans text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}
                {showCourierCols && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {o.shipment?.trackingUrl ? (
                      <a
                        href={o.shipment.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                        title="Open the Steadfast tracking page"
                      >
                        {o.shipment.trackingNo ?? "Track"} ↗
                      </a>
                    ) : o.shipment?.trackingNo ? (
                      <span className="font-mono text-xs">{o.shipment.trackingNo}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}
                {/* Steadfast Delivery Charge (§6l) — the ACTUAL charge from the
                    webhook/API; "—" until it arrives (estimate in the tooltip) */}
                {showChargeCol && (
                  <TableCell className="text-right">
                    {o.shipment?.steadfastDeliveryCharge != null ? (
                      money(o.shipment.steadfastDeliveryCharge)
                    ) : (
                      <span
                        className="text-muted-foreground"
                        title={
                          o.shipment?.courierCostEstimated != null
                            ? `Estimate: ${money(o.shipment.courierCostEstimated)} — actual not received yet`
                            : "No charge received yet"
                        }
                      >
                        —
                      </span>
                    )}
                  </TableCell>
                )}
                {/* Steadfast Weight (§6l) — the courier's figure; falls back to
                    our own recorded weight with an "(ours)" marker */}
                {isTransitTab && (
                  <TableCell className="whitespace-nowrap text-right text-xs">
                    {o.shipment?.steadfastWeightKg != null ? (
                      `${o.shipment.steadfastWeightKg} kg`
                    ) : o.shipment?.weightKg != null ? (
                      <span
                        className="text-muted-foreground"
                        title="Our recorded weight — Steadfast's figure not received yet"
                      >
                        {o.shipment.weightKg} kg (ours)
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}
                {/* Return (§6n): receive action while pending, stamp once done */}
                {isReturnedTab && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {o.shipment?.returnReceivedAt ? (
                      <div>
                        <Badge variant="outline" className="bg-green-100 text-green-800">
                          Received
                        </Badge>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {formatDate(o.shipment.returnReceivedAt)}
                        </div>
                      </div>
                    ) : o.shipment ? (
                      canPackOrders ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openReceive([o])}
                        >
                          <PackageCheck className="mr-1 size-3.5" />
                          Receive
                        </Button>
                      ) : (
                        <Badge variant="outline" className="bg-orange-100 text-orange-800">
                          Awaiting receive
                        </Badge>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No courier shipment
                      </span>
                    )}
                  </TableCell>
                )}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {isTrashTab ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openNotes(o)}
                      className={cn(
                        "rounded-md border p-1.5 transition-colors hover:bg-muted",
                        hasNote
                          ? "border-primary/40 text-primary"
                          : "text-muted-foreground"
                      )}
                      title={hasNote ? "View / update notes" : "Add a note"}
                      aria-label={`Notes for ${o.orderNo}`}
                    >
                      <NotebookPen className="size-4" />
                    </button>
                  )}
                </TableCell>
                <TableCell>{o.salesExecutive}</TableCell>
                {/* Actions (§6e): view / edit / trash — restore on the Trash tab */}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {isTrashTab ? (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={restoringId === o.id}
                        onClick={() => restoreOrder(o)}
                      >
                        <ArchiveRestore className="mr-1 size-3.5" />
                        {restoringId === o.id ? "Restoring…" : "Restore"}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-0.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        title="View details"
                        asChild
                      >
                        <Link href={`/orders/${o.id}`}>
                          <Eye className="size-4" />
                        </Link>
                      </Button>
                      {EDITABLE_STATUSES.includes(o.status) && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          title="Edit order"
                          asChild
                        >
                          <Link href={`/orders/${o.id}/edit`}>
                            <Pencil className="size-4" />
                          </Link>
                        </Button>
                      )}
                      {canTrash && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          title={
                            TRASHABLE_STATUSES.includes(o.status)
                              ? "Move to trash"
                              : "This status cannot be trashed"
                          }
                          disabled={!TRASHABLE_STATUSES.includes(o.status)}
                          onClick={() => setTrashOrder(o)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
              );
            })}
            {orders.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={colCount}
                  className="text-center text-muted-foreground"
                >
                  {isTrashTab
                    ? "The trash is empty."
                    : "No orders match the current filters."}
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

        {/* Send to Steadfast — confirm (§2) then per-order result table (§2 step 3).
            Zone + weight per order feed the courier cost estimate (§1); sending
            from CONFIRMED auto-packs first (§6j). */}
        <Dialog open={confirmOpen} onOpenChange={(o) => !o && closeSendDialog()}>
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>
                {results ? "Steadfast results" : "Send to Steadfast"}
              </DialogTitle>
              <DialogDescription>
                {results
                  ? "Orders that succeeded have moved to “Handed to courier”."
                  : `Review ${selectedOrders.length} order${
                      selectedOrders.length === 1 ? "" : "s"
                    } — a consignment is created for each and the order is handed over.${
                      activeStatus === "CONFIRMED"
                        ? " Confirmed orders are packed automatically first (stock deducts, costs freeze) — exactly as a manual pack."
                        : ""
                    } Zone + weight set the expected courier cost; Steadfast's actual charge overrides it later.`}
              </DialogDescription>
            </DialogHeader>

            {!results ? (
              <div className="max-h-[50vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead className="text-right">COD</TableHead>
                      <TableHead>Zone</TableHead>
                      <TableHead className="text-right">Weight (kg)</TableHead>
                      <TableHead className="text-right">Est. cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedOrders.map((o) => {
                      const e = estimates[o.id];
                      const est = estimateFor(o.id);
                      return (
                        <TableRow key={o.id}>
                          <TableCell className="font-mono text-xs">
                            {o.orderNo}
                            <div className="font-sans text-[11px] text-muted-foreground">
                              {o.recipientPhone}
                            </div>
                          </TableCell>
                          <TableCell>{o.recipientName}</TableCell>
                          <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">
                            {joinAddress(o.deliveryAddress, o.thana, o.district)}
                          </TableCell>
                          <TableCell className="text-right">{money(o.codAmount)}</TableCell>
                          <TableCell>
                            <Select
                              value={e?.zone ?? ""}
                              onValueChange={(v) =>
                                setEstimates((prev) => ({
                                  ...prev,
                                  [o.id]: {
                                    zone: v as DeliveryZoneValue,
                                    weightKg: prev[o.id]?.weightKg ?? "",
                                  },
                                }))
                              }
                            >
                              <SelectTrigger className="h-8 w-[130px] text-xs">
                                <SelectValue placeholder="Zone…" />
                              </SelectTrigger>
                              <SelectContent>
                                {DELIVERY_ZONES.map((z) => (
                                  <SelectItem key={z} value={z}>
                                    {DELIVERY_ZONE_LABELS[z]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              step="0.1"
                              className="ml-auto h-8 w-20 text-right text-xs"
                              placeholder="—"
                              value={e?.weightKg ?? ""}
                              onChange={(ev) =>
                                setEstimates((prev) => ({
                                  ...prev,
                                  [o.id]: {
                                    zone: prev[o.id]?.zone ?? "",
                                    weightKg: ev.target.value,
                                  },
                                }))
                              }
                            />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                            {est != null ? money(est) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
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

        {/* Status change confirm (§6g) — single & bulk; failures listed inline */}
        <Dialog
          open={statusChange !== null}
          onOpenChange={(o) => !o && !statusBusy && setStatusChange(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                Move to {statusChange ? ORDER_STATUS_LABELS[statusChange.to] : ""}
              </DialogTitle>
              <DialogDescription>
                {statusChange && statusChange.orders.length === 1
                  ? `${statusChange.orders[0].orderNo}: ${ORDER_STATUS_LABELS[statusChange.orders[0].status]} → ${ORDER_STATUS_LABELS[statusChange.to]}.`
                  : `${statusChange?.orders.length ?? 0} orders move to ${
                      statusChange ? ORDER_STATUS_LABELS[statusChange.to] : ""
                    }.`}{" "}
                Stock and history behave exactly as on the order page.
              </DialogDescription>
            </DialogHeader>
            {statusResults ? (
              <div className="max-h-[40vh] overflow-auto rounded-md border">
                <Table>
                  <TableBody>
                    {statusResults.map((r) => (
                      <TableRow key={r.orderNo}>
                        <TableCell className="font-mono text-xs">{r.orderNo}</TableCell>
                        <TableCell className="text-xs">
                          {r.ok ? (
                            <span className="text-green-700">✓ moved</span>
                          ) : (
                            <span className="text-destructive">✗ {r.error}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="grid gap-1.5">
                <Label className="text-xs">
                  {statusChange?.to === "CANCELLED"
                    ? "Cancellation reason (required)"
                    : "Note (optional)"}
                </Label>
                <Textarea
                  rows={2}
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  placeholder={
                    statusChange?.to === "CANCELLED"
                      ? "Why is this order cancelled?"
                      : "Logged in the status history"
                  }
                />
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStatusChange(null)}
                disabled={statusBusy}
              >
                {statusResults ? "Close" : "Cancel"}
              </Button>
              {!statusResults && (
                <Button
                  onClick={applyStatusChange}
                  disabled={
                    statusBusy ||
                    (statusChange?.to === "CANCELLED" && !statusNote.trim())
                  }
                >
                  {statusBusy
                    ? "Applying…"
                    : `Move ${statusChange?.orders.length ?? 0} order${
                        (statusChange?.orders.length ?? 0) === 1 ? "" : "s"
                      }`}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Trash confirm (§6f) */}
        <Dialog
          open={trashOrder !== null}
          onOpenChange={(o) => !o && !trashBusy && setTrashOrder(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Move {trashOrder?.orderNo} to Trash?</DialogTitle>
              <DialogDescription>
                The order disappears from all lists and reports and any reserved
                stock is released. It stays restorable from the Trash tab for 30
                days, then it is deleted permanently.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setTrashOrder(null)}
                disabled={trashBusy}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmTrash} disabled={trashBusy}>
                {trashBusy ? "Trashing…" : "Move to Trash"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Full item list (§6c) — the "+N more" chip target */}
        <Dialog open={itemsOrder !== null} onOpenChange={(o) => !o && setItemsOrder(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Items — {itemsOrder?.orderNo}</DialogTitle>
              <DialogDescription>
                {itemsOrder?.items.length} line item
                {(itemsOrder?.items.length ?? 0) === 1 ? "" : "s"} on this order.
              </DialogDescription>
            </DialogHeader>
            <ul className="grid max-h-[50vh] gap-1.5 overflow-auto text-sm">
              {itemsOrder?.items.map((it) => (
                <li
                  key={it.id}
                  className="flex items-center justify-between rounded-md border px-3 py-1.5"
                >
                  <span className="min-w-0 truncate">{it.name}</span>
                  <span className="ml-3 shrink-0 text-muted-foreground">
                    × {it.qty}
                  </span>
                </li>
              ))}
            </ul>
            <DialogFooter className="sm:justify-between">
              {itemsOrder && !isTrashTab ? (
                <Button variant="outline" asChild>
                  <Link href={`/orders/${itemsOrder.id}`}>Open order</Link>
                </Button>
              ) : (
                <span />
              )}
              <Button onClick={() => setItemsOrder(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Receive + damage inspection (§6n) — single & multi-select */}
        <ReturnReceiveDialog
          targets={receiveTargets}
          onClose={() => setReceiveTargets(null)}
          onDone={() => {
            setSelected(new Set());
            router.refresh();
          }}
        />

        {/* Note modal — 3 tabs, view & update (CORRECTIONS Orders §6d) */}
        <Dialog open={noteOrder !== null} onOpenChange={(o) => !o && setNoteOrder(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Notes — {noteOrder?.orderNo}</DialogTitle>
              <DialogDescription>
                View and update your note. Courier Note travels to Steadfast
                with the parcel; Invoice Note prints on the invoice.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-1 rounded-md bg-muted p-1 text-sm">
              {(
                [
                  ["order", "Order Note", noteDraft.order],
                  ["invoice", "Invoice Note", noteDraft.invoice],
                  ["courier", "Courier Note", noteDraft.courier],
                ] as const
              ).map(([key, label, value]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setNoteTab(key)}
                  className={cn(
                    "flex-1 rounded-sm px-2 py-1.5 font-medium transition-colors",
                    noteTab === key
                      ? "bg-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                  {value.trim() ? " •" : ""}
                </button>
              ))}
            </div>
            <Textarea
              rows={4}
              value={noteDraft[noteTab]}
              onChange={(e) =>
                setNoteDraft((d) => ({ ...d, [noteTab]: e.target.value }))
              }
              placeholder={
                noteTab === "order"
                  ? "Internal — visible to the team only"
                  : noteTab === "invoice"
                    ? "Printed on the invoice — the customer sees this"
                    : "Delivery instructions — sent to Steadfast"
              }
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setNoteOrder(null)}>
                Cancel
              </Button>
              <Button onClick={saveNotes} disabled={noteSaving}>
                {noteSaving ? "Saving…" : "Save notes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
