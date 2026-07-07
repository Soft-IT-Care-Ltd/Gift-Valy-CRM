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
import { money, formatDate } from "@/lib/format";

export interface ReturnRow {
  shipmentId: number;
  orderId: number;
  orderNo: string;
  courier: string;
  recipientName: string;
  district: string;
  returnedAt: string | null;
  totalAmount: number;
  advanceAmount: number;
  dueAmount: number;
  returnCharge: number | null;
}

export function ReturnsClient({
  pending,
  approved,
}: {
  pending: ReturnRow[];
  approved: ReturnRow[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState<ReturnRow | null>(null);
  const [returnCharge, setReturnCharge] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  function openApprove(r: ReturnRow) {
    setTarget(r);
    setReturnCharge("");
    setNote("");
  }

  async function approve() {
    if (!target) return;
    setSaving(true);
    const res = await fetch(`/api/shipments/${target.shipmentId}/return-approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        returnCharge: Number(returnCharge) || 0,
        note: note || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Failed to approve return");
      return;
    }
    toast.success(`Return approved — stock restored for ${target.orderNo}`);
    setTarget(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Return approvals</h1>
        <p className="text-sm text-muted-foreground">
          SPEC §1.3 — approving a return restores the packed stock and records the
          return courier charge as an expense. Refund any advance from the order page.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Awaiting approval ({pending.length})</CardTitle>
          <CardDescription>
            Returned parcels — stock is held out until approved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Courier</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Returned</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Advance paid</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((r) => (
                <TableRow key={r.shipmentId}>
                  <TableCell>
                    <Link href={`/orders/${r.orderId}`} className="font-mono text-sm underline">
                      {r.orderNo}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.district}</div>
                  </TableCell>
                  <TableCell>{r.courier}</TableCell>
                  <TableCell>{r.recipientName}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {r.returnedAt ? formatDate(r.returnedAt) : "—"}
                  </TableCell>
                  <TableCell className="text-right">{money(r.totalAmount)}</TableCell>
                  <TableCell className="text-right">
                    {r.advanceAmount > 0 ? (
                      <span className="text-amber-700">{money(r.advanceAmount)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" onClick={() => openApprove(r)}>
                      Approve & restore stock
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {pending.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No returns awaiting approval.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {approved.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recently approved</CardTitle>
            <CardDescription>Last 20 approved returns.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Courier</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead className="text-right">Return charge</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {approved.map((r) => (
                  <TableRow key={r.shipmentId}>
                    <TableCell>
                      <Link href={`/orders/${r.orderId}`} className="font-mono text-sm underline">
                        {r.orderNo}
                      </Link>
                    </TableCell>
                    <TableCell>{r.courier}</TableCell>
                    <TableCell>{r.recipientName}</TableCell>
                    <TableCell>{r.district}</TableCell>
                    <TableCell className="text-right">
                      {r.returnCharge != null ? money(r.returnCharge) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">Stock restored</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve return — {target?.orderNo}</DialogTitle>
            <DialogDescription>
              Restores the packed stock (IN_RETURN) and posts the return courier
              charge as an expense.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {target && target.advanceAmount > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                {money(target.advanceAmount)} advance was paid — record a refund from
                the order page if it is being returned to the customer.
              </div>
            )}
            <div className="grid gap-2">
              <Label>Return courier charge (৳, optional)</Label>
              <Input
                type="number"
                min="0"
                placeholder="Charge paid to the courier for the return"
                value={returnCharge}
                onChange={(e) => setReturnCharge(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Note (optional)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button onClick={approve} disabled={saving}>
              {saving ? "Saving…" : "Approve & restore stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
