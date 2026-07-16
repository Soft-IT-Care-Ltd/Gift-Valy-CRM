"use client";

// Owner Dashboard date-range filter (SPEC §13). Writes the selection to the
// URL (?range&from&to) and lets the server component re-render with the new
// window. Uses the app-wide DateFilter dropdown; dash range keys are the same
// preset keys, so the value maps 1:1.
import { useRouter, useSearchParams } from "next/navigation";
import { DateFilter } from "@/components/ui/date-filter";
import { isDashRange, type DashRangeKey } from "@/lib/dashboard-constants";
import type { DateFilterPreset } from "@/lib/date-filter";

export function DateRangeSwitch() {
  const router = useRouter();
  const params = useSearchParams();
  const current: DashRangeKey = isDashRange(params.get("range") ?? undefined)
    ? (params.get("range") as DashRangeKey)
    : "today";

  return (
    <DateFilter
      value={current}
      from={params.get("from") ?? ""}
      to={params.get("to") ?? ""}
      onApply={(preset: DateFilterPreset, from: string, to: string) => {
        const sp = new URLSearchParams();
        sp.set("range", preset);
        if (preset === "custom") {
          if (from) sp.set("from", from);
          if (to) sp.set("to", to);
        }
        router.push(`/?${sp.toString()}`);
      }}
    />
  );
}
