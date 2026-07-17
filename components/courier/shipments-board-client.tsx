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
import { money, formatDate } from "@/lib/format";
import {
  SHIPMENT_NEXT_STATUSES,
  SHIPMENT_STATUS_LABELS,
  type ShipmentStatusValue,
} from "@/lib/courier-constants";
import { STEADFAST_COURIER_NAME, normalizeBdPhone } from "@/lib/steadfast-constants";

export interface CourierOptionRow {
  id: number;
  name: string;
  codFeePercent: number;
}

export interface PendingHandoverOrder {
  id: number;
  orderNo: string;
  recipientName: string;
  recipientPhoneBd: string;
  district: string;
  thana: string;
  codAmount: number;
  dueAmount: number;
  salesExecutive: string;
}

export interface ActiveShipmentRow {
  id: number;
  orderId: number;
  orderNo: string;
  recipientName: string;
  district: string;
  courier: string;
  trackingNo: string | null;
  handoverDate: string;
  expectedDelivery: string | null;
  codAmount: number;
  status: ShipmentStatusValue;
  codReceived: boolean;
  // Steadfast integration (STEADFAST_INTEGRATION.md §3B)
  isSteadfast: boolean;
  steadfastStatus: string | null;
  onHold: boolean;
  needsAttention: boolean;
}

export function ShipmentStatusBadge({ status }: { status: ShipmentStatusValue }) {
  const variant =
    status === "DELIVERED"
      ? "secondary"
      : status === "RETURNED"
        ? "destructive"
        : "outline";
  return <Badge variant={variant}>{SHIPMENT_STATUS_LABELS[status]}</Badge>;
}

export function ShipmentsBoardClient({
  pending,
  active,
  recent,
  couriers,
  today,
  steadfastEnabled,
}: {
  pending: PendingHandoverOrder[];
  active: ActiveShipmentRow[];
  recent: ActiveShipmentRow[];
  couriers: CourierOptionRow[];
  today: string;
  steadfastEnabled: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  // ---- Steadfast poll / "Sync now" (STEADFAST_INTEGRATION.md §3B) ----
  const [syncing, setSyncing] = useState<number | "all" | null>(null);
  async function syncNow(shipmentId?: number) {
    setSyncing(shipmentId ?? "all");
    const res = await fetch("/api/couriers/steadfast/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(shipmentId ? { shipmentId } : {}),
    });
    setSyncing(null);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(data?.error ?? "Sync failed");
      return;
    }
    toast.success(
      `Synced ${data.polled} shipment${data.polled === 1 ? "" : "s"} — ${data.changed} updated`
    );
    router.refresh();
  }

  // ---- handover dialog ----
  const [hoOrder, setHoOrder] = useState<PendingHandoverOrder | null>(null);
  const [courierId, setCourierId] = useState("");
  const [trackingNo, setTrackingNo] = useState("");
  const [handoverDate, setHandoverDate] = useState(today);
  const [codAmount, setCodAmount] = useState("");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [hoNote, setHoNote] = useState("");

  function openHandover(o: PendingHandoverOrder) {
    setHoOrder(o);
    setCourierId(couriers[0] ? String(couriers[0].id) : "");
    setTrackingNo("");
    setHandoverDate(today);
    setCodAmount(String(o.codAmount));
    setExpectedDelivery("");
    setHoNote("");
  }

  // Steadfast auto-booking (STEADFAST_INTEGRATION.md §2): picking the Steadfast
  // courier with the tracking field left blank creates the consignment via the
  // API on save; a typed tracking number records a manual handover instead.
  const selectedCourier = couriers.find((c) => String(c.id) === courierId);
  const steadfastSelected =
    steadfastEnabled && selectedCourier?.name === STEADFAST_COURIER_NAME;
  const steadfastAuto = steadfastSelected && !trackingNo.trim();
  const hoPhoneInvalid =
    steadfastAuto && !!hoOrder && !normalizeBdPhone(hoOrder.recipientPhoneBd);

  async function handOver() {
    if (!hoOrder) return;
    setSaving(true);
    const res = await fetch("/api/shipments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: hoOrder.id,
        courierId: Number(courierId),
        trackingNo: trackingNo || null,
        handoverDate,
        codAmount: Number(codAmount) || 0,
        expectedDelivery: expectedDelivery || null,
        note: hoNote || null,
      }),
    });
    setSaving(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(data?.error ?? "Failed to hand over");
      return;
    }
    toast.success(
      data?.trackingCode
        ? `${hoOrder.orderNo} sent to Steadfast — tracking ${data.trackingCode}`
        : `${hoOrder.orderNo} handed to courier`
    );
    setHoOrder(null);
    router.refresh();
  }

  // ---- status update dialog ----
  const [stShipment, setStShipment] = useState<ActiveShipmentRow | null>(null);
  const [stTo, setStTo] = useState<ShipmentStatusValue | null>(null);
  const [stNote, setStNote] = useState("");
  const [stCost, setStCost] = useState("");

  function openStatus(s: ActiveShipmentRow, to: ShipmentStatusValue) {
    setStShipment(s);
    setStTo(to);
    setStNote("");
    setStCost("");
  }

  async function changeStatus() {
    if (!stShipment || !stTo) return;
    setSaving(true);
    const res = await fetch(`/api/shipments/${stShipment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: stTo,
        note: stNote || null,
        courierCostActual: stCost ? Number(stCost) : null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to update shipment");
      return;
    }
    toast.success(`${stShipment.orderNo} → ${SHIPMENT_STATUS_LABELS[stTo]}`);
    setStShipment(null);
    setStTo(null);
    router.refresh();
  }

  const noCouriers = couriers.length === 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Shipments</h1>
        <p className="text-sm text-muted-foreground">
          R-side of SPEC §7 — hand packed orders to a courier and track delivery.
        </p>
      </div>

      {noCouriers && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          No active couriers yet — configure Steadfast on the{" "}
          <Link href="/courier" className="underline">
            Courier page
          </Link>{" "}
          before handing orders over.
        </div>
      )}

      {/* Pending handover (SPEC §7 / R6) */}
      <Card>
        <CardHeader>
          <CardTitle>Pending handover ({pending.length})</CardTitle>
          <CardDescription>
            Packed orders waiting to be given to a courier.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>District</TableHead>
                <TableHead className="text-right">COD</TableHead>
                <TableHead>SE</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <Link href={`/orders/${o.id}`} className="font-mono text-sm underline">
                      {o.orderNo}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{o.recipientName}</div>
                    <div className="text-xs text-muted-foreground">{o.recipientPhoneBd}</div>
                  </TableCell>
                  <TableCell>
                    {o.district || "—"}
                    {o.thana && (
                      <span className="text-muted-foreground"> · {o.thana}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{money(o.codAmount)}</TableCell>
                  <TableCell className="text-muted-foreground">{o.salesExecutive}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" onClick={() => openHandover(o)} disabled={noCouriers}>
                      Hand over
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {pending.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    Nothing waiting for handover.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Active shipments */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle>In transit ({active.length})</CardTitle>
            <CardDescription>
              Handed over or in transit — advance the status as the courier reports.
            </CardDescription>
          </div>
          {steadfastEnabled && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncNow()}
              disabled={syncing !== null}
            >
              {syncing === "all" ? "Syncing…" : "Sync now"}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Courier</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead>Handover</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead className="text-right">COD</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Update</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/orders/${s.orderId}`} className="font-mono text-sm underline">
                      {s.orderNo}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {s.recipientName}
                      {s.district ? ` · ${s.district}` : ""}
                    </div>
                  </TableCell>
                  <TableCell>{s.courier}</TableCell>
                  <TableCell className="font-mono text-xs">{s.trackingNo ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(s.handoverDate)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {s.expectedDelivery ? formatDate(s.expectedDelivery) : "—"}
                  </TableCell>
                  <TableCell className="text-right">{money(s.codAmount)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <ShipmentStatusBadge status={s.status} />
                      {s.onHold && (
                        <Badge variant="outline" className="bg-amber-100 text-amber-800">
                          ⚠ On hold
                        </Badge>
                      )}
                      {s.needsAttention && (
                        <Badge variant="outline" className="bg-orange-100 text-orange-800">
                          ⚠ Needs attention
                        </Badge>
                      )}
                    </div>
                    {s.isSteadfast && s.steadfastStatus && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        Steadfast: {s.steadfastStatus}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {s.isSteadfast && steadfastEnabled && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Sync status from Steadfast"
                          onClick={() => syncNow(s.id)}
                          disabled={syncing !== null}
                        >
                          {syncing === s.id ? "…" : "⟳"}
                        </Button>
                      )}
                      {SHIPMENT_NEXT_STATUSES[s.status].map((to) => (
                        <Button
                          key={to}
                          size="sm"
                          variant={to === "RETURNED" ? "destructive" : "outline"}
                          onClick={() => openStatus(s, to)}
                        >
                          {SHIPMENT_STATUS_LABELS[to]}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {active.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                    No active shipments.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recently closed shipments (read-only context) */}
      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recently delivered / returned</CardTitle>
            <CardDescription>Last 20 closed shipments.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Courier</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead className="text-right">COD</TableHead>
                  <TableHead>COD received</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link href={`/orders/${s.orderId}`} className="font-mono text-sm underline">
                        {s.orderNo}
                      </Link>
                    </TableCell>
                    <TableCell>{s.courier}</TableCell>
                    <TableCell>{s.district || "—"}</TableCell>
                    <TableCell className="text-right">{money(s.codAmount)}</TableCell>
                    <TableCell>
                      {s.codAmount <= 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : s.codReceived ? (
                        <Badge variant="secondary">Received</Badge>
                      ) : (
                        <Badge variant="outline">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <ShipmentStatusBadge status={s.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Handover dialog */}
      <Dialog open={!!hoOrder} onOpenChange={(o) => !o && setHoOrder(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hand over {hoOrder?.orderNo}</DialogTitle>
            <DialogDescription>
              Creates the shipment and moves the order to “Handed to courier”.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Courier</Label>
              <Select value={courierId} onValueChange={setCourierId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a courier" />
                </SelectTrigger>
                <SelectContent>
                  {couriers.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name} · COD fee {c.codFeePercent}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Tracking / consignment no (optional)</Label>
              <Input
                value={trackingNo}
                onChange={(e) => setTrackingNo(e.target.value)}
                placeholder={steadfastSelected ? "Leave blank to book via API" : undefined}
              />
              {steadfastAuto && !hoPhoneInvalid && (
                <p className="text-xs text-muted-foreground">
                  Steadfast is connected — the consignment will be created via the
                  API and the tracking code filled in automatically.
                </p>
              )}
              {steadfastSelected && !!trackingNo.trim() && (
                <p className="text-xs text-muted-foreground">
                  A tracking number is entered, so this records a manual handover
                  (no consignment is created at Steadfast).
                </p>
              )}
              {hoPhoneInvalid && hoOrder && (
                <p className="text-xs text-destructive">
                  Recipient phone “{hoOrder.recipientPhoneBd}” is not a valid
                  11-digit BD number — fix it on the order before sending to
                  Steadfast, or enter a tracking number manually.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Handover date</Label>
                <Input
                  type="date"
                  value={handoverDate}
                  onChange={(e) => setHandoverDate(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Expected delivery (optional)</Label>
                <Input
                  type="date"
                  value={expectedDelivery}
                  onChange={(e) => setExpectedDelivery(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>COD amount (৳)</Label>
              <Input
                type="number"
                min="0"
                value={codAmount}
                onChange={(e) => setCodAmount(e.target.value)}
              />
              {hoOrder && Number(codAmount) !== hoOrder.dueAmount && (
                <p className="text-xs text-muted-foreground">
                  Order due is {money(hoOrder.dueAmount)}.
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label>Note (optional)</Label>
              <Textarea value={hoNote} onChange={(e) => setHoNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHoOrder(null)}>
              Cancel
            </Button>
            <Button
              onClick={handOver}
              disabled={saving || !courierId || !handoverDate || hoPhoneInvalid}
            >
              {saving ? "Saving…" : steadfastAuto ? "Send to Steadfast" : "Hand over"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status update dialog */}
      <Dialog open={!!stShipment} onOpenChange={(o) => !o && setStShipment(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {stShipment?.orderNo} → {stTo ? SHIPMENT_STATUS_LABELS[stTo] : ""}
            </DialogTitle>
            <DialogDescription>
              {stTo === "RETURNED"
                ? "The order is marked returned. Stock is restored only after Admin approval under Returns."
                : "The change is logged in the order status history."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {stTo === "DELIVERED" && (
              <div className="grid gap-2">
                <Label>Actual courier cost (৳, optional)</Label>
                <Input
                  type="number"
                  min="0"
                  placeholder="Amount paid to the courier"
                  value={stCost}
                  onChange={(e) => setStCost(e.target.value)}
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label>Note (optional)</Label>
              <Textarea value={stNote} onChange={(e) => setStNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStShipment(null)}>
              Cancel
            </Button>
            <Button
              variant={stTo === "RETURNED" ? "destructive" : "default"}
              onClick={changeStatus}
              disabled={saving}
            >
              {saving ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
