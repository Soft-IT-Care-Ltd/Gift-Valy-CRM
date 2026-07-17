"use client";

// CORRECTIONS Orders §2 / Stock §1 — the shared forward-looking period selector
// for the Delivery Schedule and the Requirement Planner. Preset buttons apply
// immediately (URL nav); Custom reveals from/to inputs + Apply. Reads the applied
// selection from props so a reload / back-button restores the right state.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DELIVERY_PERIODS,
  DELIVERY_PERIOD_LABELS,
  deliveryPeriodRange,
  type DeliveryPeriod,
} from "@/lib/delivery-schedule";

export function DeliveryPeriodFilter({
  basePath,
  period,
  from,
  to,
  extraParams,
}: {
  basePath: string; // "/delivery-schedule" | "/stock/requirement-planner"
  period: DeliveryPeriod;
  from: string;
  to: string;
  // preserved across period changes (e.g. the planner's DRAFT toggle)
  extraParams?: Record<string, string>;
}) {
  const router = useRouter();
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const [showCustom, setShowCustom] = useState(period === "custom");

  function go(next: Record<string, string>) {
    const params = new URLSearchParams({ ...(extraParams ?? {}), ...next });
    router.push(`${basePath}?${params.toString()}`);
  }

  function pick(p: DeliveryPeriod) {
    if (p === "custom") {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    go({ period: p });
  }

  function applyCustom() {
    if (!customFrom || !customTo) return;
    go({ period: "custom", from: customFrom, to: customTo });
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1">
        {DELIVERY_PERIODS.map((p) => {
          const active = period === p || (p === "custom" && showCustom);
          const range = p === "custom" ? null : deliveryPeriodRange(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => pick(p)}
              title={range ? `${range.from} → ${range.to}` : undefined}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {DELIVERY_PERIOD_LABELS[p]}
            </button>
          );
        })}
      </div>
      {showCustom && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            From
            <Input
              type="date"
              className="h-8 w-40"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            To
            <Input
              type="date"
              className="h-8 w-40"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            onClick={applyCustom}
            disabled={!customFrom || !customTo}
          >
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
