"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { formatDateTime } from "@/lib/format";

// Settings → WhatsApp Invoice (SPEC §5 / §16 Phase 4). Meta WhatsApp Cloud
// API credentials + the auto-send switch, plus a recent-sends log so failures
// (expired token, 24h window) are visible at a glance.

export interface WhatsAppSettingsView {
  configured: boolean;
  isEnabled: boolean;
  autoSendInvoice: boolean;
  phoneNumberId: string;
  accessTokenMasked: string | null;
  connectedAt: string | null;
  lastSentAt: string | null;
}

export interface WhatsAppLogRow {
  id: number;
  orderId: number;
  orderNo: string;
  toPhone: string;
  trigger: string;
  status: "SENT" | "FAILED";
  error: string | null;
  sentByName: string | null;
  createdAt: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  AUTO_CONFIRM: "Auto · order confirmed",
  AUTO_EDIT: "Auto · invoice updated",
  MANUAL: "Manual",
};

export function WhatsAppSettingsClient({
  initial,
  logs,
}: {
  initial: WhatsAppSettingsView;
  logs: WhatsAppLogRow[];
}) {
  const router = useRouter();
  const [s, setS] = useState<WhatsAppSettingsView>(initial);
  const [phoneNumberId, setPhoneNumberId] = useState(initial.phoneNumberId);
  const [accessToken, setAccessToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  async function save(patch?: { isEnabled?: boolean; autoSendInvoice?: boolean }) {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/whatsapp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumberId,
          // empty field = keep the stored token
          accessToken: accessToken || undefined,
          ...patch,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save");
      setS(body as WhatsAppSettingsView);
      setPhoneNumberId((body as WhatsAppSettingsView).phoneNumberId);
      setAccessToken("");
      toast.success("WhatsApp settings saved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const res = await fetch("/api/settings/whatsapp/test", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Connection test failed");
      toast.success(
        `Connected: ${body.verifiedName ?? "unnamed"} (${body.displayPhoneNumber ?? "?"})`
      );
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Connection test failed");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">WhatsApp invoice sending</h1>
        <p className="text-sm text-muted-foreground">
          Sends the invoice PDF straight to the customer&apos;s WhatsApp via the
          Meta Cloud API — automatically when an order is confirmed (and when an
          approved edit regenerates the invoice), or from the order page&apos;s
          “Send via WhatsApp” button. The wa.me chat link keeps working either
          way.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Meta Cloud API credentials
            {s.configured ? (
              <Badge variant="secondary">Configured</Badge>
            ) : (
              <Badge variant="outline">Not configured</Badge>
            )}
          </CardTitle>
          <CardDescription>
            From Meta Business → WhatsApp → API Setup: the Phone Number ID of
            the Gift Valy WhatsApp number, and a permanent (System User) access
            token with <code>whatsapp_business_messaging</code> permission. The
            token is stored encrypted and never shown again after saving.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid max-w-md gap-1">
            <Label className="text-xs">Phone Number ID</Label>
            <Input
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="e.g. 123456789012345"
            />
          </div>
          <div className="grid max-w-md gap-1">
            <Label className="text-xs">Access Token</Label>
            <Input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={
                s.accessTokenMasked
                  ? `Saved (${s.accessTokenMasked}) — enter to replace`
                  : "EAAG…"
              }
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save()} disabled={busy}>
              Save credentials
            </Button>
            <Button
              variant="outline"
              onClick={testConnection}
              disabled={testing || !s.configured}
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
          </div>
          {s.connectedAt && (
            <p className="text-xs text-muted-foreground">
              Last verified: {formatDateTime(s.connectedAt)}
              {s.lastSentAt ? ` · Last sent: ${formatDateTime(s.lastSentAt)}` : ""}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sending</CardTitle>
          <CardDescription>
            WhatsApp only allows free-form messages within 24 hours of the
            customer&apos;s last message. Customers normally order over WhatsApp
            moments earlier, so this rarely matters — a blocked send is logged
            below and the SE can use the chat link instead.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Enable WhatsApp sending</div>
              <p className="text-xs text-muted-foreground">
                Master switch for both automatic and button sends.
              </p>
            </div>
            <Switch
              checked={s.isEnabled}
              onCheckedChange={(v) => save({ isEnabled: v })}
              disabled={busy}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">
                Auto-send invoice on confirmation
              </div>
              <p className="text-xs text-muted-foreground">
                Push the PDF to the customer as soon as the invoice is generated
                or regenerated after an approved edit.
              </p>
            </div>
            <Switch
              checked={s.autoSendInvoice}
              onCheckedChange={(v) => save({ autoSendInvoice: v })}
              disabled={busy || !s.isEnabled}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent sends</CardTitle>
          <CardDescription>Latest 20 attempts, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nothing sent yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Link
                        href={`/orders/${l.orderId}`}
                        className="font-mono text-xs underline-offset-2 hover:underline"
                      >
                        {l.orderNo}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">+{l.toPhone}</TableCell>
                    <TableCell className="text-xs">
                      {TRIGGER_LABELS[l.trigger] ?? l.trigger}
                      {l.sentByName ? ` · ${l.sentByName}` : ""}
                    </TableCell>
                    <TableCell>
                      {l.status === "SENT" ? (
                        <Badge variant="secondary">Sent</Badge>
                      ) : (
                        <Badge variant="destructive" title={l.error ?? undefined}>
                          Failed
                        </Badge>
                      )}
                      {l.status === "FAILED" && l.error && (
                        <p className="mt-1 max-w-64 text-xs text-muted-foreground">
                          {l.error}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(l.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
