"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Tab strip shared by the three P&L views (R9) so they read as one workspace.
const TABS = [
  { href: "/reports/pnl/daily", label: "Daily summary" },
  { href: "/reports/pnl/monthly", label: "Monthly P&L" },
  { href: "/reports/pnl/orders", label: "Per-order profit" },
];

export function PnlNav() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
