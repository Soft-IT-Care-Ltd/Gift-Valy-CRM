"use client";

// Owner Dashboard date-range switch (SPEC §13). Writes the selection to the URL
// (?range&from&to) and lets the server component re-render with the new window.
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  DASH_RANGES,
  DASH_RANGE_LABELS,
  isDashRange,
  type DashRangeKey,
} from "@/lib/dashboard-constants";

export function DateRangeSwitch() {
  const router = useRouter();
  const params = useSearchParams();
  const current: DashRangeKey = isDashRange(params.get("range") ?? undefined)
    ? (params.get("range") as DashRangeKey)
    : "today";

  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");

  function go(range: DashRangeKey, extra?: { from?: string; to?: string }) {
    const sp = new URLSearchParams();
    sp.set("range", range);
    if (range === "custom") {
      if (extra?.from) sp.set("from", extra.from);
      if (extra?.to) sp.set("to", extra.to);
    }
    router.push(`/?${sp.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border bg-card p-0.5">
        {DASH_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => go(r, r === "custom" ? { from, to } : undefined)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              current === r
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {DASH_RANGE_LABELS[r]}
          </button>
        ))}
      </div>
      {current === "custom" && (
        <div className="flex items-center gap-1.5 text-sm">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border bg-card px-2 py-1"
            aria-label="From date"
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border bg-card px-2 py-1"
            aria-label="To date"
          />
          <button
            type="button"
            onClick={() => go("custom", { from, to })}
            className="rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
