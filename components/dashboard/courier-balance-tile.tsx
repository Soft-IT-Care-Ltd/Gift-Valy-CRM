"use client";

// CORRECTIONS Dashboard §6 — Steadfast Courier Balance KPI tile.
// Fetches the live balance from the existing /get_balance route (courier.manage
// gated) on mount and on the refresh icon; shows "—" when the integration is
// off or the viewer has no courier access. Kept client-side so a slow/failing
// courier API never blocks the dashboard render.
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

type Status = "idle" | "loading" | "ok" | "error";
type BalanceResult = { ok: true; balance: number } | { ok: false };

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
}: {
  enabled: boolean;
  canManage: boolean;
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
        <div className="mt-1 text-2xl font-bold tabular-nums">
          {status === "ok" && balance !== null ? money(balance) : "—"}
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}
