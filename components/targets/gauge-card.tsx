"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { money } from "@/lib/format";
import type { Gauge } from "@/lib/targets-constants";

// SPEC §10 live progress gauge: achieved / target, %, days left, required daily
// run-rate. One card per SE or team.
export function GaugeCard({ gauge }: { gauge: Gauge }) {
  const hasTarget =
    gauge.targetOrders != null || gauge.targetAmount != null;

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{gauge.subjectName}</span>
            <Badge variant="outline" className="text-[10px]">
              {gauge.scope === "TEAM" ? "Team" : "Individual"}
            </Badge>
            {gauge.isConfidential && (
              <Badge variant="secondary" className="text-[10px]">
                🔒 Confidential
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {gauge.isPastMonth
              ? "Month closed"
              : gauge.isCurrentMonth
                ? `Day ${gauge.dayOfMonth} of ${gauge.daysInMonth} · ${gauge.daysLeft} day${gauge.daysLeft === 1 ? "" : "s"} left`
                : "Upcoming month"}
          </p>
        </div>
        {gauge.scope === "TEAM" && (gauge.onboardingExcludedCount ?? 0) > 0 && (
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">
            excl. {gauge.onboardingExcludedCount} onboarding
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasTarget && (
          <p className="text-sm text-muted-foreground">
            No target set for this month.
          </p>
        )}

        {gauge.targetAmount != null && (
          <Metric
            label="Sales value"
            achieved={money(gauge.achievedAmount)}
            target={money(gauge.targetAmount)}
            pct={gauge.amountPct}
            runRate={
              gauge.requiredDailyAmount != null
                ? `${money(gauge.requiredDailyAmount)}/day to hit target`
                : null
            }
          />
        )}

        {gauge.targetOrders != null && (
          <Metric
            label="Orders"
            achieved={String(gauge.achievedOrders)}
            target={String(gauge.targetOrders)}
            pct={gauge.ordersPct}
            runRate={
              gauge.requiredDailyOrders != null
                ? `${gauge.requiredDailyOrders}/day to hit target`
                : null
            }
          />
        )}

        {!hasTarget && (
          <div className="text-sm">
            <span className="text-muted-foreground">Achieved so far: </span>
            <span className="font-medium">
              {gauge.achievedOrders} orders · {money(gauge.achievedAmount)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  achieved,
  target,
  pct,
  runRate,
}: {
  label: string;
  achieved: string;
  target: string;
  pct: number | null;
  runRate: string | null;
}) {
  const clamped = Math.min(pct ?? 0, 100);
  const met = (pct ?? 0) >= 100;
  const onTrack = (pct ?? 0) >= 60;
  const barColor = met
    ? "bg-emerald-500"
    : onTrack
      ? "bg-amber-500"
      : "bg-rose-500";

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {achieved}
          <span className="text-muted-foreground"> / {target}</span>
          {pct != null && (
            <span
              className={`ml-2 font-semibold ${met ? "text-emerald-600" : ""}`}
            >
              {pct}%
            </span>
          )}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${barColor} transition-all`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {runRate && !met && (
        <p className="mt-1 text-xs text-muted-foreground">{runRate}</p>
      )}
      {met && (
        <p className="mt-1 text-xs font-medium text-emerald-600">
          🎉 Target reached
        </p>
      )}
    </div>
  );
}
