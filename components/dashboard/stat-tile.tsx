// Reusable KPI tile for the dashboards (SPEC §13). Pure/presentational.
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  sub,
  href,
  tone = "default",
  delta,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  tone?: "default" | "positive" | "negative" | "warning";
  delta?: { value: string; up: boolean } | null;
}) {
  const toneRing =
    tone === "negative"
      ? "border-destructive/40"
      : tone === "warning"
        ? "border-amber-400/50"
        : "";
  const valueColor =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "negative"
        ? "text-destructive"
        : "";

  const inner = (
    <Card className={cn("h-full", toneRing, href && "transition-colors hover:bg-muted/50")}>
      <CardContent className="p-4">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-2xl font-bold tabular-nums", valueColor)}>
          {value}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          {delta && (
            <span
              className={cn(
                "font-medium",
                delta.up
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive"
              )}
            >
              {delta.up ? "▲" : "▼"} {delta.value}
            </span>
          )}
          {sub && <span className="min-w-0 truncate">{sub}</span>}
        </div>
      </CardContent>
    </Card>
  );

  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}
