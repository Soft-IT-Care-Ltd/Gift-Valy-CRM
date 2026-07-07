"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { formatDate, formatDateTime } from "@/lib/format";

export interface PickLine {
  sku: string;
  name: string;
  unit: string;
  qty: number;
  onHand: number | null; // null = per-order product (not stock-tracked)
}

export interface PackingOrder {
  id: number;
  orderNo: string;
  createdAt: string;
  recipientName: string;
  recipientPhoneBd: string;
  district: string;
  thana: string;
  occasion: string | null;
  requestedDeliveryDate: string | null;
  notes: string | null;
  items: { name: string; isPackage: boolean; qty: number }[];
  pickList: PickLine[];
  perOrderItems: PickLine[];
}

export function PackingQueueClient({ queue }: { queue: PackingOrder[] }) {
  const router = useRouter();
  const [packingId, setPackingId] = useState<number | null>(null);

  async function markPacked(order: PackingOrder) {
    if (!confirm(`Mark ${order.orderNo} as PACKED? This deducts stock.`)) return;
    setPackingId(order.id);
    const res = await fetch(`/api/orders/${order.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "PACKED" }),
    });
    setPackingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to mark as packed");
      return;
    }
    toast.success(`${order.orderNo} packed — stock deducted`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Packing Queue</h1>
        <p className="text-sm text-muted-foreground">
          {queue.length === 0
            ? "No confirmed orders waiting to be packed."
            : `${queue.length} confirmed order${queue.length === 1 ? "" : "s"} waiting, oldest first.`}
        </p>
      </div>

      {queue.map((o) => {
        const shortage = o.pickList.some((l) => (l.onHand ?? 0) < l.qty);
        return (
          <Card key={o.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {o.orderNo}
                  {shortage && <Badge variant="destructive">Stock short</Badge>}
                  {o.requestedDeliveryDate && (
                    <Badge variant="secondary">
                      Deliver by {formatDate(o.requestedDeliveryDate)}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Confirmed {formatDateTime(o.createdAt)} · To {o.recipientName} (
                  {o.recipientPhoneBd}) · {o.thana}, {o.district}
                  {o.occasion ? ` · ${o.occasion}` : ""}
                </CardDescription>
              </div>
              <Button
                onClick={() => markPacked(o)}
                disabled={packingId === o.id || shortage}
                title={shortage ? "Not enough stock on hand — purchase or adjust first" : undefined}
              >
                {packingId === o.id ? "Packing…" : "Mark as PACKED"}
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm">
                <span className="font-medium">Order:</span>{" "}
                {o.items
                  .map((it) => `${it.qty} × ${it.name}${it.isPackage ? " (package)" : ""}`)
                  .join(", ")}
              </div>
              {o.notes && (
                <div className="rounded-md bg-muted px-3 py-2 text-sm">
                  <span className="font-medium">Note:</span> {o.notes}
                </div>
              )}

              {o.pickList.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Pick item</TableHead>
                      <TableHead className="text-right">Need</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {o.pickList.map((l) => (
                      <TableRow key={l.sku}>
                        <TableCell className="text-muted-foreground">{l.sku}</TableCell>
                        <TableCell className="font-medium">{l.name}</TableCell>
                        <TableCell className="text-right">
                          {l.qty} {l.unit}
                        </TableCell>
                        <TableCell className="text-right">{l.onHand}</TableCell>
                        <TableCell>
                          {(l.onHand ?? 0) < l.qty && (
                            <Badge variant="destructive">
                              short {l.qty - (l.onHand ?? 0)}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {o.perOrderItems.length > 0 && (
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Per-order (procure fresh):
                  </span>{" "}
                  {o.perOrderItems
                    .map((l) => `${l.qty} × ${l.name}`)
                    .join(", ")}{" "}
                  — not stock-tracked
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
