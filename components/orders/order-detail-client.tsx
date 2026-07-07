"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Download, MessageCircle, Printer } from "lucide-react";
import { PhotoField } from "@/components/catalog/photo-field";
import { money, formatDate, formatDateTime } from "@/lib/format";
import { StatusBadge } from "./orders-list-client";
import {
  MFS_METHODS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_TYPES,
  PAYMENT_TYPE_LABELS,
  orderIsInvoiceable,
  type OrderStatusValue,
  type PaymentMethodValue,
  type PaymentTypeValue,
} from "@/lib/order-constants";
import {
  SHIPMENT_STATUS_LABELS,
  type ShipmentStatusValue,
} from "@/lib/courier-constants";

export interface OrderDetail {
  id: number;
  orderNo: string;
  status: OrderStatusValue;
  cancelReason: string | null;
  createdAt: string;
  customer: {
    id: number;
    name: string;
    phoneForeign: string;
    country: string;
    fbLink: string | null;
  };
  recipientName: string;
  recipientPhoneBd: string;
  recipientRelation: string | null;
  deliveryAddress: string;
  district: string;
  thana: string;
  occasion: string | null;
  requestedDeliveryDate: string | null;
  items: {
    id: number;
    itemType: "PRODUCT" | "PACKAGE";
    name: string;
    code: string | null;
    qty: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  subtotal: number;
  discount: number;
  courierCharge: number;
  totalAmount: number;
  advanceAmount: number;
  dueAmount: number;
  codAmount: number;
  notes: string | null;
  salesExecutive: { id: number; name: string };
  team: { id: number; name: string } | null;
  payments: {
    id: number;
    paymentDate: string;
    type: PaymentTypeValue;
    method: PaymentMethodValue;
    amount: number;
    transactionId: string | null;
    senderNumber: string | null;
    screenshotUrl: string | null;
    isVerified: boolean;
  }[];
  statusHistory: {
    id: number;
    fromStatus: OrderStatusValue | null;
    toStatus: OrderStatusValue;
    byUser: string;
    at: string;
    note: string | null;
  }[];
  editRequests: {
    id: number;
    status: "PENDING" | "APPROVED" | "REJECTED";
    requestedBy: string;
    reason: string | null;
    reviewNote: string | null;
    createdAt: string;
  }[];
  invoices: {
    id: number;
    version: number;
    generatedAt: string;
  }[];
  shipment: {
    id: number;
    courier: string;
    trackingNo: string | null;
    status: ShipmentStatusValue;
    handoverDate: string;
    expectedDelivery: string | null;
    codAmount: number;
    codReceived: boolean;
    codReceivedAt: string | null;
    deliveredAt: string | null;
    returnedAt: string | null;
    returnApproved: boolean;
    consignmentId: number | null;
    steadfastStatus: string | null;
    onHold: boolean;
    needsAttention: boolean;
    trackingEvents: {
      id: number;
      message: string;
      eventAt: string;
      source: string;
    }[];
    courierCostActual?: number;
  } | null;
}

export function OrderDetailClient({
  order,
  canEdit,
  editBlockedReason,
  canRequestEdit,
  canAddPayment,
  canApprove,
  allowedTransitions,
}: {
  order: OrderDetail;
  canEdit: boolean; // direct edit (privileged or within window)
  editBlockedReason: string | null; // why direct edit is unavailable
  canRequestEdit: boolean; // SE after window
  canAddPayment: boolean;
  canApprove: boolean;
  allowedTransitions: OrderStatusValue[]; // already permission-filtered
}) {
  const router = useRouter();

  // ---- payment dialog ----
  const [payOpen, setPayOpen] = useState(false);
  const [payType, setPayType] = useState<PaymentTypeValue>("PARTIAL");
  const [payMethod, setPayMethod] = useState<PaymentMethodValue | "">("");
  const [payAmount, setPayAmount] = useState("");
  const [payTxn, setPayTxn] = useState("");
  const [paySender, setPaySender] = useState("");
  const [payScreenshot, setPayScreenshot] = useState("");
  const [saving, setSaving] = useState(false);

  const payMfsMissingTxn =
    !!payMethod && MFS_METHODS.includes(payMethod) && !payTxn.trim();

  async function addPayment() {
    setSaving(true);
    const res = await fetch(`/api/orders/${order.id}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: payType,
        method: payMethod,
        amount: Number(payAmount),
        transactionId: payTxn || null,
        senderNumber: paySender || null,
        screenshotUrl: payScreenshot || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to record payment");
      return;
    }
    const data = await res.json();
    toast.success(`Payment recorded — due is now ${money(data.due)}`);
    setPayOpen(false);
    setPayAmount("");
    setPayTxn("");
    setPaySender("");
    setPayScreenshot("");
    router.refresh();
  }

  // ---- status change dialog ----
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusTo, setStatusTo] = useState<OrderStatusValue | null>(null);
  const [statusNote, setStatusNote] = useState("");

  function openStatus(to: OrderStatusValue) {
    setStatusTo(to);
    setStatusNote("");
    setStatusOpen(true);
  }

  async function changeStatus() {
    if (!statusTo) return;
    setSaving(true);
    const res = await fetch(`/api/orders/${order.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: statusTo, note: statusNote || null }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to change status");
      return;
    }
    toast.success(`Order moved to ${ORDER_STATUS_LABELS[statusTo]}`);
    setStatusOpen(false);
    router.refresh();
  }

  // ---- edit request review ----
  async function review(requestId: number, action: "APPROVE" | "REJECT") {
    const note =
      action === "REJECT"
        ? prompt("Rejection note (optional)") ?? undefined
        : undefined;
    const res = await fetch(`/api/edit-requests/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to review edit request");
      return;
    }
    toast.success(action === "APPROVE" ? "Edit applied" : "Request rejected");
    router.refresh();
  }

  const pendingRequest = order.editRequests.find((r) => r.status === "PENDING");
  const paid = order.payments.reduce(
    (s, p) => s + (p.type === "REFUND" ? -p.amount : p.amount),
    0
  );

  // ---- invoice (§5): download / print / WhatsApp ----
  const latestInvoice = order.invoices[0] ?? null; // serialized newest-first
  const invoiceAvailable = latestInvoice !== null || orderIsInvoiceable(order.status);
  const invoiceUrl = `/api/orders/${order.id}/invoice`;

  // Loads the PDF inline in a hidden iframe and opens the print dialog.
  function printInvoice() {
    document.getElementById("invoice-print-frame")?.remove();
    const frame = document.createElement("iframe");
    frame.id = "invoice-print-frame";
    frame.style.display = "none";
    frame.src = `${invoiceUrl}?disposition=inline`;
    frame.onload = () => frame.contentWindow?.print();
    document.body.appendChild(frame);
  }

  // wa.me pre-filled message to the customer (SPEC §5) — the SE attaches the
  // downloaded PDF in the same chat.
  const waText = [
    `আসসালামু আলাইকুম ${order.customer.name}!`,
    `Gift Valy-তে অর্ডার করার জন্য আপনাকে ধন্যবাদ। আপনার ইনভয়েস:`,
    ``,
    `🧾 Invoice: ${order.orderNo}`,
    `মোট: ${money(order.totalAmount)}`,
    `অগ্রিম জমা: ${money(order.advanceAmount)}`,
    `বাকি (ডেলিভারিতে): ${money(order.dueAmount)}`,
    `প্রাপক: ${order.recipientName}, ${order.district}`,
    ``,
    `ইনভয়েস PDF টি এই চ্যাটে পাঠানো হচ্ছে। যেকোনো প্রয়োজনে মেসেজ করুন। — Gift Valy`,
  ].join("\n");
  const waHref = `https://wa.me/${order.customer.phoneForeign.replace(/\D/g, "")}?text=${encodeURIComponent(waText)}`;

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-xl font-semibold">{order.orderNo}</h1>
        <StatusBadge status={order.status} />
        <span className="text-sm text-muted-foreground">
          {formatDateTime(order.createdAt)} · {order.salesExecutive.name}
          {order.team ? ` · ${order.team.name}` : ""}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {canEdit && (
            <Button variant="outline" asChild>
              <Link href={`/orders/${order.id}/edit`}>Edit</Link>
            </Button>
          )}
          {canRequestEdit && !pendingRequest && (
            <Button variant="outline" asChild>
              <Link href={`/orders/${order.id}/edit`}>Request edit</Link>
            </Button>
          )}
          {allowedTransitions.map((to) => (
            <Button
              key={to}
              variant={to === "CANCELLED" ? "destructive" : "default"}
              onClick={() => openStatus(to)}
            >
              → {ORDER_STATUS_LABELS[to]}
            </Button>
          ))}
        </div>
      </div>

      {editBlockedReason && !canEdit && (
        <p className="text-sm text-muted-foreground">{editBlockedReason}</p>
      )}

      {order.status === "CANCELLED" && order.cancelReason && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Cancelled: {order.cancelReason}
        </div>
      )}

      {pendingRequest && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Pending edit request</span>
            <span className="text-muted-foreground">
              by {pendingRequest.requestedBy} ·{" "}
              {formatDateTime(pendingRequest.createdAt)}
            </span>
            {canApprove && (
              <span className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => review(pendingRequest.id, "APPROVE")}>
                  Approve & apply
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => review(pendingRequest.id, "REJECT")}
                >
                  Reject
                </Button>
              </span>
            )}
          </div>
          {pendingRequest.reason && (
            <p className="mt-1 text-muted-foreground">
              Reason: {pendingRequest.reason}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Customer (abroad)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <div className="font-medium">{order.customer.name}</div>
            <div>{order.customer.phoneForeign}</div>
            <div className="text-muted-foreground">{order.customer.country}</div>
            {order.customer.fbLink && (
              <a
                href={order.customer.fbLink}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline"
              >
                Profile link
              </a>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recipient (Bangladesh)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <div className="font-medium">
              {order.recipientName}
              {order.recipientRelation && (
                <span className="ml-2 text-muted-foreground">
                  ({order.recipientRelation})
                </span>
              )}
            </div>
            <div>{order.recipientPhoneBd}</div>
            <div className="text-muted-foreground">
              {order.deliveryAddress}, {order.thana}, {order.district}
            </div>
            <div className="text-muted-foreground">
              {order.occasion && <span>Occasion: {order.occasion} · </span>}
              {order.requestedDeliveryDate && (
                <span>Deliver by: {formatDate(order.requestedDeliveryDate)}</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {(order.shipment || order.status === "PACKED") && (
        <Card>
          <CardHeader>
            <CardTitle>Courier / Shipment</CardTitle>
            <CardDescription>
              {order.shipment
                ? "Managed under the Courier module — status here mirrors the shipment."
                : "Packed and ready — hand over to a courier from the Courier module."}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {order.shipment ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <div className="text-muted-foreground">Courier</div>
                  <div className="font-medium">{order.shipment.courier}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Tracking no</div>
                  <div className="font-mono text-xs">
                    {order.shipment.trackingNo ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Status</div>
                  <Badge
                    variant={
                      order.shipment.status === "DELIVERED"
                        ? "secondary"
                        : order.shipment.status === "RETURNED"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {SHIPMENT_STATUS_LABELS[order.shipment.status]}
                  </Badge>
                </div>
                <div>
                  <div className="text-muted-foreground">Handover</div>
                  <div>{formatDate(order.shipment.handoverDate)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Expected delivery</div>
                  <div>
                    {order.shipment.expectedDelivery
                      ? formatDate(order.shipment.expectedDelivery)
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">COD with courier</div>
                  <div>
                    {money(order.shipment.codAmount)}{" "}
                    {order.shipment.codAmount > 0 &&
                      (order.shipment.codReceived ? (
                        <Badge variant="secondary" className="ml-1">
                          Received
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="ml-1">
                          Pending
                        </Badge>
                      ))}
                  </div>
                </div>
                {order.shipment.deliveredAt && (
                  <div>
                    <div className="text-muted-foreground">Delivered</div>
                    <div>{formatDateTime(order.shipment.deliveredAt)}</div>
                  </div>
                )}
                {order.shipment.returnedAt && (
                  <div>
                    <div className="text-muted-foreground">Returned</div>
                    <div>
                      {formatDateTime(order.shipment.returnedAt)}
                      {!order.shipment.returnApproved && (
                        <Badge variant="outline" className="ml-1">
                          Approval pending
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
                {order.shipment.courierCostActual != null && (
                  <div>
                    <div className="text-muted-foreground">Courier cost</div>
                    <div>{money(order.shipment.courierCostActual)}</div>
                  </div>
                )}
                </div>

                {/* Steadfast flags (STEADFAST_INTEGRATION.md §3B) */}
                {(order.shipment.steadfastStatus ||
                  order.shipment.onHold ||
                  order.shipment.needsAttention) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {order.shipment.steadfastStatus && (
                      <Badge variant="outline">
                        Steadfast: {order.shipment.steadfastStatus}
                      </Badge>
                    )}
                    {order.shipment.onHold && (
                      <Badge variant="outline" className="bg-amber-100 text-amber-800">
                        ⚠ On hold
                      </Badge>
                    )}
                    {order.shipment.needsAttention && (
                      <Badge variant="outline" className="bg-orange-100 text-orange-800">
                        ⚠ Needs attention
                      </Badge>
                    )}
                  </div>
                )}

                {/* Tracking timeline (§3A payload 2) */}
                {order.shipment.trackingEvents.length > 0 && (
                  <div>
                    <div className="mb-1 text-muted-foreground">Tracking timeline</div>
                    <ol className="space-y-1.5 border-l pl-4">
                      {order.shipment.trackingEvents.map((t) => (
                        <li key={t.id} className="relative">
                          <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-muted-foreground/50" />
                          <span>{t.message}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {formatDateTime(t.eventAt)} · {t.source}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">
                No shipment yet. It appears in the Courier module&apos;s pending-handover
                queue.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Invoice (ইনভয়েস)</CardTitle>
            <CardDescription>
              {latestInvoice ? (
                <>
                  {order.orderNo} · v{latestInvoice.version} · generated{" "}
                  {formatDateTime(latestInvoice.generatedAt)}
                  {order.invoices.length > 1 &&
                    " · regenerated after an approved edit — old versions kept"}
                </>
              ) : invoiceAvailable ? (
                "Not generated yet — it will be created on first download."
              ) : (
                "Generated automatically when the order is confirmed."
              )}
            </CardDescription>
          </div>
          {invoiceAvailable && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <a href={invoiceUrl}>
                  <Download className="mr-1 size-4" /> Download PDF
                </a>
              </Button>
              <Button variant="outline" onClick={printInvoice}>
                <Printer className="mr-1 size-4" /> Print
              </Button>
              <Button asChild className="bg-green-600 text-white hover:bg-green-700">
                <a href={waHref} target="_blank" rel="noreferrer">
                  <MessageCircle className="mr-1 size-4" /> Send via WhatsApp
                </a>
              </Button>
            </div>
          )}
        </CardHeader>
        {invoiceAvailable && (
          <CardContent className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              WhatsApp opens the customer&apos;s chat with the message pre-filled —
              attach the downloaded PDF there.
            </span>
            {order.invoices.length > 1 && (
              <span className="ml-auto">
                Older versions:{" "}
                {order.invoices.slice(1).map((inv, i) => (
                  <span key={inv.id}>
                    {i > 0 && " · "}
                    <a
                      className="underline"
                      href={`${invoiceUrl}?version=${inv.version}`}
                    >
                      v{inv.version}
                    </a>
                  </span>
                ))}
              </span>
            )}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Line total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>
                    <span className="font-medium">{it.name}</span>
                    {it.code && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {it.code}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {it.itemType === "PACKAGE" ? "Package" : "Product"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{it.qty}</TableCell>
                  <TableCell className="text-right">
                    {money(it.unitPrice)}
                  </TableCell>
                  <TableCell className="text-right">
                    {money(it.lineTotal)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3 ml-auto grid max-w-xs gap-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{money(order.subtotal)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Discount</span>
              <span>−{money(order.discount)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Courier charge</span>
              <span>{money(order.courierCharge)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span>{money(order.totalAmount)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Paid</span>
              <span>{money(paid)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Due</span>
              <span className={order.dueAmount > 0 ? "text-amber-700" : ""}>
                {money(order.dueAmount)}
              </span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>COD to collect</span>
              <span>{money(order.codAmount)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Payments</CardTitle>
            <CardDescription>
              Every payment recomputes the due amount. MFS transaction IDs are
              globally unique.
            </CardDescription>
          </div>
          {canAddPayment && (
            <Button onClick={() => setPayOpen(true)}>Add payment</Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Txn ID</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Verified</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{formatDateTime(p.paymentDate)}</TableCell>
                  <TableCell>{PAYMENT_TYPE_LABELS[p.type]}</TableCell>
                  <TableCell>{PAYMENT_METHOD_LABELS[p.method]}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.transactionId ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {p.type === "REFUND" ? (
                      <span className="text-red-600">−{money(p.amount)}</span>
                    ) : (
                      money(p.amount)
                    )}
                  </TableCell>
                  <TableCell>
                    {p.isVerified ? (
                      <Badge variant="secondary">Verified</Badge>
                    ) : (
                      <Badge variant="outline">Unverified</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {order.payments.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground"
                  >
                    No payments recorded.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Status history</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {order.statusHistory.map((h) => (
              <div key={h.id} className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(h.at)}
                </span>
                <span>
                  {h.fromStatus
                    ? `${ORDER_STATUS_LABELS[h.fromStatus]} → `
                    : "Created as "}
                  <span className="font-medium">
                    {ORDER_STATUS_LABELS[h.toStatus]}
                  </span>
                </span>
                <span className="text-muted-foreground">by {h.byUser}</span>
                {h.note && (
                  <span className="w-full text-xs text-muted-foreground">
                    “{h.note}”
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Notes & edit requests</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div>
              <div className="text-muted-foreground">Internal notes</div>
              <div>{order.notes ?? "—"}</div>
            </div>
            {order.editRequests.length > 0 && (
              <div className="grid gap-2">
                <div className="text-muted-foreground">Edit requests</div>
                {order.editRequests.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        r.status === "PENDING"
                          ? "outline"
                          : r.status === "APPROVED"
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {r.status}
                    </Badge>
                    <span>{r.requestedBy}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(r.createdAt)}
                    </span>
                    {r.reason && (
                      <span className="w-full text-xs text-muted-foreground">
                        “{r.reason}”
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add payment dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add payment — {order.orderNo}</DialogTitle>
            <DialogDescription>
              Current due: {money(order.dueAmount)}. Refunds are entered as
              positive amounts and add back to due.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select
                  value={payType}
                  onValueChange={(v) => setPayType(v as PaymentTypeValue)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {PAYMENT_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Method</Label>
                <Select
                  value={payMethod}
                  onValueChange={(v) => setPayMethod(v as PaymentMethodValue)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick method" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Amount (৳)</Label>
                <Input
                  type="number"
                  min="0"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>
                  Transaction ID
                  {payMethod && MFS_METHODS.includes(payMethod)
                    ? ""
                    : " (optional)"}
                </Label>
                <Input
                  value={payTxn}
                  onChange={(e) => setPayTxn(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Sender wallet number (optional)</Label>
              <Input
                value={paySender}
                onChange={(e) => setPaySender(e.target.value)}
              />
            </div>
            <PhotoField value={payScreenshot} onChange={setPayScreenshot} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={addPayment}
              disabled={
                saving ||
                !payMethod ||
                !(Number(payAmount) > 0) ||
                payMfsMissingTxn
              }
            >
              {saving ? "Saving…" : "Record payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status change dialog */}
      <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Move to {statusTo ? ORDER_STATUS_LABELS[statusTo] : ""}
            </DialogTitle>
            <DialogDescription>
              {statusTo === "CANCELLED"
                ? "A cancel reason is required and will be stored on the order."
                : "The change is timestamped and logged in the status history."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>
              {statusTo === "CANCELLED" ? "Cancel reason" : "Note (optional)"}
            </Label>
            <Textarea
              value={statusNote}
              onChange={(e) => setStatusNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={statusTo === "CANCELLED" ? "destructive" : "default"}
              onClick={changeStatus}
              disabled={
                saving || (statusTo === "CANCELLED" && !statusNote.trim())
              }
            >
              {saving ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
