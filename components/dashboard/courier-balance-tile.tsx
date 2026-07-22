"use client";

// CORRECTIONS Dashboard §6 — Steadfast Courier Balance KPI tile.
// Fetches the live balance from the existing /get_balance route (courier.manage
// gated) on mount and on the refresh icon; shows "—" when the integration is
// off or the viewer has no courier access. Kept client-side so a slow/failing
// courier API never blocks the dashboard render.
//
// CORRECTIONS Orders §R8 — two additions: the latest payout invoice renders as
// a sub-line (server-provided, any status — a fresh payment request shows as
// Processing until Steadfast pays it), and a "Request payment" deep link into
// the Steadfast merchant panel appears while the balance is > 0 (their V1 API
// has no payment-request endpoint — the request is made in their panel, and
// the /payments sync picks up the resulting processing → paid record).
import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  STEADFAST_PANEL_PAYMENT_REQUEST_URL,
  STEADFAST_PAYMENT_STATUS_LABELS,
  type SteadfastPaymentStatusValue,
} from "@/lib/steadfast-payments-constants";

type Status = "idle" | "loading" | "ok" | "error";
type BalanceResult = { ok: true; balance: number } | { ok: false };

export interface LatestPayout {
  invoiceNo: string | null;
  netAmount: number;
  date: string; // ISO
  parcels: number;
  status: SteadfastPaymentStatusValue;
}

// Pure fetch/parse — no React state, so both the mount effect and the refresh
// handler can share it without tripping react-hooks/set-state-in-effect.
async function fetchBalance(): Promise<BalanceResult> {
  const res = await fetch("/api/couriers/steadfast/balance", {
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  return data?.ok ? { ok: true, balance: Number(data.balance) } : { ok: false };
}

export function CourierBalanceTile({
  enabled,
  canManage,
  latestPayout = null,
}: {
  enabled: boolean;
  canManage: boolean;
  latestPayout?: LatestPayout | null;
}) {
  const active = enabled && canManage;
  const [balance, setBalance] = useState<number | null>(null);
  // Start in "loading" when we will fetch on mount, so the effect never has to
  // call setState synchronously (react-hooks/set-state-in-effect).
  const [status, setStatus] = useState<Status>(active ? "loading" : "idle");

  // Initial load — inline .then so setState lands in the callback, not in the
  // effect body (the repo's fetch-on-mount convention).
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetchBalance()
      .then((r) => {
        if (cancelled) return;
        if (r.ok) setBalance(r.balance);
        setStatus(r.ok ? "ok" : "error");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  // Refresh icon — setState in an event handler is fine.
  async function refresh() {
    setStatus("loading");
    const r = await fetchBalance().catch(() => ({ ok: false }) as BalanceResult);
    if (r.ok) setBalance(r.balance);
    setStatus(r.ok ? "ok" : "error");
  }

  const loading = status === "loading";
  const sub = !canManage
    ? "No courier access"
    : !enabled
      ? "Integration disabled"
      : status === "error"
        ? "Couldn't fetch balance"
        : loading
          ? "Loading…"
          : "Steadfast · live";

  const payoutDate = latestPayout
    ? new Date(latestPayout.date).toLocaleDateString("en-GB", {
        timeZone: "Asia/Dhaka",
        day: "numeric",
        month: "short",
      })
    : null;

  return (
    <Card className="h-full">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-muted-foreground">
            Courier balance
          </div>
          {active && (
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="Refresh courier balance"
              title="Refresh"
              className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </button>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <div className="mt-1 text-2xl font-bold tabular-nums">
            {status === "ok" && balance !== null ? money(balance) : "—"}
          </div>
          {active && status === "ok" && balance !== null && balance > 0 && (
            <a
              href={STEADFAST_PANEL_PAYMENT_REQUEST_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-primary hover:underline"
              title="Open the Steadfast panel's payment request page"
            >
              Request payment
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{sub}</div>
        {canManage && latestPayout && (
          <div
            className="mt-0.5 truncate text-xs text-muted-foreground"
            title={latestPayout.invoiceNo ?? undefined}
          >
            Latest payout {money(latestPayout.netAmount)} · {latestPayout.parcels}{" "}
            parcel{latestPayout.parcels === 1 ? "" : "s"}
            {payoutDate ? ` · ${payoutDate}` : ""} ·{" "}
            <span
              className={cn(
                "font-medium",
                latestPayout.status === "PAID"
                  ? "text-green-600 dark:text-green-400"
                  : "text-amber-600 dark:text-amber-400"
              )}
            >
              {STEADFAST_PAYMENT_STATUS_LABELS[latestPayout.status]}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
