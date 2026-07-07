"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import { money, formatDateTime } from "@/lib/format";

export interface SteadfastSettings {
  configured: boolean;
  isEnabled: boolean;
  pollingMinutes: number;
  apiKeyMasked: string | null;
  secretKeyMasked: string | null;
  hasWebhookToken: boolean;
  webhookTokenMasked: string | null;
  callbackUrl: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastWebhookAt: string | null;
}

export interface StatusLogRow {
  id: number;
  source: string;
  rawStatus: string | null;
  receivedAt: string;
  orderNo: string | null;
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Copy failed — select and copy manually");
  }
}

export function SteadfastSettingsClient({
  initial,
  logs,
}: {
  initial: SteadfastSettings;
  logs: StatusLogRow[];
}) {
  const router = useRouter();
  const [s, setS] = useState(initial);

  // Key inputs are write-only: empty means "keep the stored key".
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [enabled, setEnabled] = useState(initial.isEnabled);
  const [polling, setPolling] = useState(String(initial.pollingMinutes));

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [tokenPlain, setTokenPlain] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    const res = await fetch("/api/couriers/steadfast/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: apiKey || undefined,
        secretKey: secretKey || undefined,
        isEnabled: enabled,
        pollingMinutes: Number(polling) || 60,
      }),
    });
    setSaving(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(data?.error ?? "Failed to save");
      return;
    }
    setS(data);
    setApiKey("");
    setSecretKey("");
    toast.success("Settings saved");
    router.refresh();
  }

  async function testConnection() {
    setTesting(true);
    const res = await fetch("/api/couriers/steadfast/test", { method: "POST" });
    setTesting(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(data?.error ?? "Test failed");
      return;
    }
    if (!data.ok) {
      toast.error(data.error ?? "Connection failed");
      return;
    }
    setBalance(data.balance);
    toast.success(`Connected ✓ — balance ${money(data.balance)}`);
    router.refresh();
  }

  async function refreshBalance() {
    const res = await fetch("/api/couriers/steadfast/balance");
    const data = await res.json().catch(() => null);
    if (data?.ok) setBalance(data.balance);
    else toast.error(data?.error ?? "Failed to fetch balance");
  }

  async function regenerateToken() {
    if (
      s.hasWebhookToken &&
      !confirm(
        "Regenerate the webhook token? The old token stops working immediately — update the Steadfast panel with the new one."
      )
    ) {
      return;
    }
    const res = await fetch("/api/couriers/steadfast/webhook-token", {
      method: "POST",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(data?.error ?? "Failed to generate token");
      return;
    }
    setTokenPlain(data.token);
    setS({ ...s, hasWebhookToken: true });
    toast.success("Webhook token generated — copy it now");
    router.refresh();
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Steadfast Integration</h1>
        <p className="text-sm text-muted-foreground">
          Connect the Steadfast courier API — send packed orders, and sync
          delivery status via webhook (live) with polling as a fallback.
        </p>
      </div>

      {/* Connection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Connection
            {s.isEnabled ? (
              <Badge className="bg-green-100 text-green-800">Enabled</Badge>
            ) : (
              <Badge variant="outline">Disabled</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Keys are encrypted at rest and only used server-side.
            {s.connectedAt
              ? ` Last verified ${formatDateTime(s.connectedAt)}.`
              : " Not verified yet."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>API Key</Label>
              <Input
                placeholder={s.apiKeyMasked ?? "Enter API Key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Secret Key</Label>
              <Input
                type="password"
                placeholder={s.secretKeyMasked ?? "Enter Secret Key"}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          {s.configured && (
            <p className="text-xs text-muted-foreground">
              Keys are saved. Leave the fields blank to keep them; type to replace.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <span className="text-sm font-medium">Integration enabled</span>
            </label>
            <div className="flex items-center gap-2">
              <Label className="text-sm">Polling interval (min)</Label>
              <Input
                type="number"
                min={1}
                className="w-24"
                value={polling}
                onChange={(e) => setPolling(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
            <Button
              variant="outline"
              onClick={testConnection}
              disabled={testing || !s.configured}
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
            {balance !== null && (
              <span className="flex items-center gap-2 text-sm">
                <Badge variant="secondary">Balance {money(balance)}</Badge>
                <button
                  onClick={refreshBalance}
                  className="text-xs text-muted-foreground underline"
                >
                  refresh
                </button>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Webhook */}
      <Card>
        <CardHeader>
          <CardTitle>Webhook (live status)</CardTitle>
          <CardDescription>
            Paste this Callback URL and Bearer token into the Steadfast panel →
            Webhook Integration.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Callback URL</Label>
            <div className="flex gap-2">
              <Input readOnly value={s.callbackUrl} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                onClick={() => copy(s.callbackUrl, "Callback URL")}
              >
                Copy
              </Button>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Bearer token</Label>
            {tokenPlain ? (
              <div className="grid gap-1.5">
                <div className="flex gap-2">
                  <Input readOnly value={tokenPlain} className="font-mono text-xs" />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => copy(tokenPlain, "Token")}
                  >
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-amber-700">
                  Copy this now — it is shown only once and cannot be retrieved later.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-muted-foreground">
                  {s.hasWebhookToken ? (s.webhookTokenMasked ?? "••••") : "Not generated"}
                </span>
                <Button type="button" variant="outline" onClick={regenerateToken}>
                  {s.hasWebhookToken ? "Regenerate" : "Generate"}
                </Button>
              </div>
            )}
          </div>

          <Separator />
          <div className="text-sm text-muted-foreground">
            Last webhook received:{" "}
            {s.lastWebhookAt ? (
              <span className="font-medium text-foreground">
                {formatDateTime(s.lastWebhookAt)}
              </span>
            ) : (
              "never"
            )}
            {s.lastSyncAt && (
              <> · Last poll sync: {formatDateTime(s.lastSyncAt)}</>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Integration log (§5) */}
      <Card>
        <CardHeader>
          <CardTitle>Recent status updates</CardTitle>
          <CardDescription>
            The last raw status payloads received from Steadfast (webhook + poll).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Order</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(l.receivedAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{l.source}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {l.rawStatus ?? "—"}
                  </TableCell>
                  <TableCell>
                    {l.orderNo ? (
                      <span className="font-mono text-xs">{l.orderNo}</span>
                    ) : (
                      <span className="text-muted-foreground">unmatched</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {logs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    No status updates received yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
