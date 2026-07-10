"use client";

import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { monthLabel } from "@/lib/targets-constants";

// Prev / next / jump month navigation. Writes ?month=YYYY-MM so the server page
// recomputes gauges for the chosen month.
export function MonthSwitcher({ monthKey }: { monthKey: string }) {
  const router = useRouter();
  const pathname = usePathname();

  const go = (key: string) => router.push(`${pathname}?month=${key}`);

  const shift = (delta: number) => {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    go(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => shift(-1)}>
        ← Prev
      </Button>
      <input
        type="month"
        value={monthKey}
        onChange={(e) => e.target.value && go(e.target.value)}
        className="h-9 rounded-md border bg-background px-2 text-sm"
        aria-label="Month"
      />
      <span className="hidden text-sm font-medium sm:inline">
        {monthLabel(monthKey)}
      </span>
      <Button variant="outline" size="sm" onClick={() => shift(1)}>
        Next →
      </Button>
    </div>
  );
}
