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
import { RefreshCw } from "lucide-react";
import { money, formatDateTime } from "@/lib/format";
import {
  DELIVERY_ZONE_LABELS,
  DELIVERY_ZONES,
  type DeliveryZoneValue,
} from "@/lib/order-constants";

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

export interface ZoneRateRow {
  zone: DeliveryZoneValue;
  baseRate: number;
  perKgRate: number;
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Copy failed — select and copy manually");
  }
}

// The Courier page (CORRECTIONS Courier §2): the Steadfast integration —
// connection, webhook, Sync Now, recent status log — plus the 3-zone courier
// cost rate config (§1). API keys / webhook token stay Admin-only
// (settings.manage); courier.manage roles see status and manage zone rates.
export function SteadfastCourierClient({
  initial,
  logs,
  zoneRates,
  overchargeTolerancePct,
  stuckAmberDays,
  stuckRedDays,
  canManageKeys,
}: {
  initial: SteadfastSettings;
  logs: StatusLogRow[];
  zoneRates: ZoneRateRow[];
  overchargeTolerancePct: number;
  stuckAmberDays: number; // §R6 — stuck-parcel escalation thresholds (days)
  stuckRedDays: number;
  canManageKeys: boolean;
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
  const [syncing, setSyncing] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [tokenPlain, setTokenPlain] = useState<string | null>(null);

  // Zone rate table (CORRECTIONS Courier §1) — kept as strings while editing.
  const [rates, setRates] = useState(() =>
    DELIVERY_ZONES.map((zone) => {
      const row = zoneRates.find((r) => r.zone === zone);
      return {
        zone,
        baseRate: String(row?.baseRate ?? 0),
        perKgRate: String(row?.perKgRate ?? 0),
      };
    })
  );
  const [savingRates, setSavingRates] = useState(false);
  // §R4 — overcharge alert tolerance (percent), edited alongside the zone rates.
  const [tolerance, setTolerance] = useState(String(overchargeTolerancePct));
  // §R6 — stuck-parcel escalation thresholds (days), saved with the rates.
  const [amberDays, setAmberDays] = useState(String(stuckAmberDays));
  const [redDays, setRedDays] = useState(String(stuckRedDays));

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

  async function syncNow() {
    setSyncing(true);
    const res = await fetch("/api/couriers/steadfast/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setSyncing(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(data?.error ?? "Sync failed");
      return;
    }
    toast.success(
      `Synced — ${data.polled} shipment${data.polled === 1 ? "" : "s"} polled, ${data.changed} updated`
    );
    router.refresh();
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

  async function saveRates() {
    setSavingRates(true);
    const res = await fetch("/api/couriers/steadfast/zone-rates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rates: rates.map((r) => ({
          zone: r.zone,
          baseRate: Math.max(Number(r.baseRate) || 0, 0),
          perKgRate: Math.max(Number(r.perKgRate) || 0, 0),
        })),
        overchargeTolerancePct: Math.min(
          Math.max(Number(tolerance) || 0, 0),
          100
        ),
        stuckAmberDays: Math.max(Number(amberDays) || 0, 0),
        stuckRedDays: Math.max(Number(redDays) || 0, 0),
      }),
    });
    setSavingRates(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(data?.error ?? "Failed to save zone rates");
      return;
    }
    toast.success("Zone rates saved");
    router.refresh();
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Courier — Steadfast</h1>
        <p className="text-sm text-muted-foreground">
          The Steadfast courier integration: connection, live webhook status,
          manual sync, and the zone + weight cost rates used for courier cost
          estimates.
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
          {canManageKeys && (
            <>
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
            </>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {canManageKeys && (
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save settings"}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={testConnection}
              disabled={testing || !s.configured}
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <Button
              variant="outline"
              onClick={syncNow}
              disabled={syncing || !s.isEnabled}
              title="Poll Steadfast for status updates on all live consignments"
            >
              <RefreshCw className={`mr-1 size-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync now"}
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

      {/* Zone + weight cost rates (CORRECTIONS Courier §1) */}
      <Card>
        <CardHeader>
          <CardTitle>Courier cost rates (zone + weight)</CardTitle>
          <CardDescription>
            What Gift Valy pays Steadfast per parcel: base rate + per-kg rate
            for each zone. Handover uses these for the expected courier cost;
            the actual charge from the Steadfast webhook overrides the estimate
            in P&amp;L when it arrives.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Zone</TableHead>
                <TableHead className="text-right">Base rate (৳)</TableHead>
                <TableHead className="text-right">Per kg (৳)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((r, i) => (
                <TableRow key={r.zone}>
                  <TableCell className="font-medium">
                    {DELIVERY_ZONE_LABELS[r.zone]}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      className="ml-auto w-28 text-right"
                      value={r.baseRate}
                      onChange={(e) =>
                        setRates((prev) =>
                          prev.map((row, j) =>
                            j === i ? { ...row, baseRate: e.target.value } : row
                          )
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      className="ml-auto w-28 text-right"
                      value={r.perKgRate}
                      onChange={(e) =>
                        setRates((prev) =>
                          prev.map((row, j) =>
                            j === i ? { ...row, perKgRate: e.target.value } : row
                          )
                        )
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {/* §R4 — overcharge alert tolerance: how far Steadfast's counted
              weight/charge may exceed our estimate before the In Transit tab
              flags it red. */}
          <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-4">
            <div className="grid gap-1.5">
              <Label htmlFor="overcharge-tol" className="text-sm">
                Overcharge alert tolerance
              </Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id="overcharge-tol"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className="w-24"
                  value={tolerance}
                  onChange={(e) => setTolerance(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Flag a parcel when Steadfast&apos;s weight or charge is more than
                this % above our own figure.
              </p>
            </div>
            {/* §R6 — stuck-parcel escalation: how many days in the current
                courier sub-status turns the In Transit Duration badge amber,
                then red. The amber threshold also defines the "stuck" count. */}
            <div className="grid gap-1.5">
              <Label className="text-sm">Stuck-parcel escalation (days)</Label>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-amber-500" />
                  <Input
                    aria-label="Amber after days"
                    type="number"
                    min={0}
                    step={1}
                    className="w-20"
                    value={amberDays}
                    onChange={(e) => setAmberDays(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-red-500" />
                  <Input
                    aria-label="Red after days"
                    type="number"
                    min={0}
                    step={1}
                    className="w-20"
                    value={redDays}
                    onChange={(e) => setRedDays(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                A parcel sitting in one courier status this long goes amber, then
                red — and counts toward the In Transit &ldquo;stuck&rdquo; tally.
              </p>
            </div>
            <Button onClick={saveRates} disabled={savingRates}>
              {savingRates ? "Saving…" : "Save rates"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Estimate = base + per-kg × parcel weight (BOM item sum, editable at
            send time).
          </p>
        </CardContent>
      </Card>

      {/* Webhook — token management is Admin-only */}
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
                {canManageKeys && (
                  <Button type="button" variant="outline" onClick={regenerateToken}>
                    {s.hasWebhookToken ? "Regenerate" : "Generate"}
                  </Button>
                )}
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
            The last raw payloads received from Steadfast (webhook + poll) and
            logged API responses.
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
