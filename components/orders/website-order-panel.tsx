"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Globe, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatDateTime } from "@/lib/format";
import { DELIVERY_DATE_MODE_LABELS, DELIVERY_ZONE_LABELS, type DeliveryDateModeValue, type DeliveryZoneValue } from "@/lib/order-constants";
import { WEBSITE_CANCEL_REASONS, type WebsiteCancelReason } from "@/lib/website-order-constants";
import type { WebsiteOrderPanelData } from "@/lib/website-orders";

// ROUND3 W-6 — the Website panel on a website order: who has it and why,
// what the customer typed (and where it differs from the saved customer),
// WhatsApp the customer, Confirm (= record the advance: the existing payment
// flow runs confirmDraftTx and gives the GV number), Cancel with a reason,
// and — for a TL/Manager — hand it to another Sales Executive.

export function WebsiteOrderPanel({
  orderId,
  data,
  onRecordAdvance,
  canAddPayment,
}: {
  orderId: number;
  data: WebsiteOrderPanelData;
  onRecordAdvance: () => void;
  canAddPayment: boolean;
}) {
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState<WebsiteCancelReason | "">("");
  const [seller, setSeller] = useState("");
  const [saving, setSaving] = useState(false);
  const c = data.contact;

  async function post(url: string, body: unknown, ok: string) {
    setSaving(true);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? "Something went wrong");
      return false;
    }
    toast.success(ok);
    router.refresh();
    return true;
  }

  return (
    <Card className="border-sky-300 dark:border-sky-900">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Globe className="size-4 text-sky-700" />
          Website order <span className="font-mono">{data.ref}</span>
          {data.waiting ? (
            <Badge variant="outline" className="border-sky-300 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
              Needs confirmation
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div className="grid gap-1 text-muted-foreground">
          <div>
            Placed {formatDateTime(data.placedAt)}
            {data.assignedTo ? (
              <>
                {" "}· with <span className="font-medium text-foreground">{data.assignedTo.name}</span>
                {data.assignedAt ? ` since ${formatDateTime(data.assignedAt)}` : ""}
              </>
            ) : (
              <span className="font-medium text-amber-700"> · not assigned to anyone yet</span>
            )}
          </div>
          {data.assignReason ? <div>Why: {data.assignReason}</div> : null}
          {data.link ? (
            <div className="flex flex-wrap items-center gap-1">
              Customer&apos;s page:
              <a href={data.link} target="_blank" rel="noreferrer" className="break-all text-blue-600 hover:underline">
                {data.link}
              </a>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Copy the customer's page link"
                onClick={() => navigator.clipboard?.writeText(data.link!).then(() => toast.success("Link copied"))}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          ) : null}
        </div>

        {data.flags.length > 0 ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            {data.flags.map((f) => (
              <p key={f}>⚠ {f}</p>
            ))}
          </div>
        ) : null}

        {c ? (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-0.5 rounded-md border p-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Typed by the customer — sender</div>
              <Typed label="Name" value={c.sender.name} differs={data.differs.name} saved={data.saved.name} />
              <Typed label="Country" value={c.sender.country} differs={data.differs.country} saved={data.saved.country} />
              <Typed label="WhatsApp" value={c.sender.whatsapp} extra={c.sender.whatsappTyped !== c.sender.whatsapp ? `typed “${c.sender.whatsappTyped}”` : undefined} />
            </div>
            <div className="grid gap-0.5 rounded-md border p-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recipient in Bangladesh</div>
              <Typed label="Name" value={c.recipient.name} />
              <Typed label="Mobile" value={c.recipient.phone} extra={c.recipient.phoneTyped !== c.recipient.phone ? `typed “${c.recipient.phoneTyped}”` : undefined} />
              {c.recipient.relation ? <Typed label="Relation" value={c.recipient.relation} /> : null}
              <Typed label="Address" value={c.recipient.address} />
              <Typed label="Area" value={DELIVERY_ZONE_LABELS[c.recipient.zone as DeliveryZoneValue] ?? c.recipient.zone} />
              <Typed
                label="When"
                value={`${DELIVERY_DATE_MODE_LABELS[c.delivery.mode as DeliveryDateModeValue] ?? c.delivery.mode}${c.delivery.date ? ` — ${formatDate(c.delivery.date)}` : ""}`}
              />
              {c.occasion ? <Typed label="Occasion" value={c.occasion} /> : null}
              {c.note ? <Typed label="Note" value={c.note} /> : null}
            </div>
          </div>
        ) : null}
        {data.differs.name || data.differs.country ? (
          <p className="text-xs text-muted-foreground">
            Highlighted: different from the saved customer ({data.saved.phone}). The saved customer was not changed — edit the customer yourself if the new details are right.
          </p>
        ) : null}

        {data.waiting ? (
          <div className="flex flex-wrap items-center gap-2">
            {data.whatsappHref ? (
              <Button variant="outline" asChild>
                <a href={data.whatsappHref} target="_blank" rel="noreferrer">
                  <MessageCircle className="size-4" /> WhatsApp the customer
                </a>
              </Button>
            ) : null}
            {canAddPayment ? (
              <Button onClick={onRecordAdvance}>Confirm — record the advance</Button>
            ) : null}
            {data.canCancel ? (
              <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                Cancel…
              </Button>
            ) : null}
            {data.canAssign && data.sellers.length > 0 ? (
              <span className="ml-auto flex items-center gap-2">
                <Select value={seller} onValueChange={setSeller}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Give to…" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.sellers.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)} disabled={s.id === data.assignedTo?.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  disabled={!seller || saving}
                  onClick={async () => {
                    if (await post(`/api/orders/${orderId}/website/assign`, { userId: Number(seller) }, "Reassigned — the Sales Executive got a notification")) setSeller("");
                  }}
                >
                  Reassign
                </Button>
              </span>
            ) : null}
          </div>
        ) : null}
        {data.waiting && canAddPayment ? (
          <p className="text-xs text-muted-foreground">
            Recording the advance confirms the order: it gets its order number, stock is reserved and the invoice is made.
          </p>
        ) : null}
      </CardContent>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel website order {data.ref}</DialogTitle>
            <DialogDescription>It never got an order number, so it won&apos;t count anywhere. Its lead is marked lost with the same reason.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as WebsiteCancelReason)}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent>
                {WEBSITE_CANCEL_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={!reason || saving}
              onClick={async () => {
                if (await post(`/api/orders/${orderId}/website/cancel`, { reason }, `Website order ${data.ref} cancelled`)) setCancelOpen(false);
              }}
            >
              {saving ? "Cancelling…" : "Cancel the order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Typed({ label, value, differs = false, saved, extra }: { label: string; value: string; differs?: boolean; saved?: string; extra?: string }) {
  return (
    <div className="grid grid-cols-[84px_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={differs ? "rounded bg-amber-100 px-1 text-amber-950 dark:bg-amber-900/50 dark:text-amber-100" : undefined}>
        {value}
        {differs && saved ? <span className="ml-1 text-xs opacity-80">(saved: {saved})</span> : null}
        {extra ? <span className="ml-1 text-xs text-muted-foreground">{extra}</span> : null}
      </span>
    </div>
  );
}
