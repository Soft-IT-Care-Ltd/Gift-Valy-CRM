// Pure-SVG dashboard charts (SPEC §13 Rows 2/3/5). No client JS and no Recharts
// — each is a server-renderable presentational component that draws with the
// app's theme tokens (var(--chart-*), var(--muted-foreground)…) so light/dark
// both work. Responsive: viewBox + preserveAspectRatio, strokes use
// vectorEffect="non-scaling-stroke" so they stay crisp at any width.

import { money } from "@/lib/format";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--purple-400)",
  "var(--muted-foreground)",
];

export function chartColor(i: number): string {
  return CHART_COLORS[i % CHART_COLORS.length];
}

// ---------- multi-series line chart ----------

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
}

export function LineChart({
  series,
  labels,
  height = 150,
  maxTicks = 6,
}: {
  series: LineSeries[];
  labels: string[];
  height?: number;
  maxTicks?: number;
}) {
  const n = labels.length;
  const peak = Math.max(1, ...series.flatMap((s) => s.values));
  const W = 100;
  const H = 100;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - (v / peak) * 88;

  const path = (values: number[]) =>
    "M" + values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" L");

  // Sparse x-axis labels so long ranges don't crowd.
  const step = Math.max(1, Math.ceil(n / maxTicks));
  const tickIdx = labels.map((_, i) => i).filter((i) => i % step === 0 || i === n - 1);

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={series.map((s) => s.name).join(" and ") + " trend"}
      >
        {[0, 22, 44, 66, 88].map((gy) => (
          <line
            key={gy}
            x1="0"
            y1={gy}
            x2={W}
            y2={gy}
            stroke="var(--border)"
            strokeWidth="0.2"
            strokeDasharray="1 1.5"
          />
        ))}
        {series.map((s) => (
          <path
            key={s.name}
            d={path(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        {tickIdx.map((i) => (
          <span key={i}>{labels[i]}</span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: s.color }}
            />
            <span className="text-muted-foreground">{s.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- horizontal funnel ----------

export function Funnel({
  stages,
}: {
  stages: { key: string; label: string; count: number }[];
}) {
  const top = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const pct = Math.round((s.count / top) * 100);
        const conv =
          i === 0 || stages[i - 1].count === 0
            ? null
            : Math.round((s.count / stages[i - 1].count) * 100);
        return (
          <div key={s.key} className="flex items-center gap-3">
            <div className="w-20 shrink-0 text-xs text-muted-foreground">
              {s.label}
            </div>
            <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-muted">
              <div
                className="flex h-full items-center rounded-md px-2 text-xs font-semibold text-white"
                style={{
                  width: `${Math.max(pct, 8)}%`,
                  background: chartColor(i),
                }}
              >
                {s.count}
              </div>
            </div>
            <div className="w-12 shrink-0 text-right text-[11px] text-muted-foreground">
              {conv != null ? `${conv}%` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- donut ----------

export function Donut({
  slices,
  total,
  centerLabel = "Total",
  size = 132,
}: {
  slices: { name: string; amount: number; share: number }[];
  total: number;
  centerLabel?: string;
  size?: number;
}) {
  const R = 42;
  const C = 2 * Math.PI * R;
  const stroke = 16;
  const nonZero = slices.filter((s) => s.amount > 0);
  const sum = nonZero.reduce((s, x) => s + x.amount, 0) || 1;

  // Precompute each arc's start offset functionally (no outer-variable mutation
  // during render). n ≤ 7 so the O(n²) prefix sum is negligible.
  const arcs = nonZero.map((s, i) => {
    const dash = (s.amount / sum) * C;
    const startOffset = nonZero
      .slice(0, i)
      .reduce((a, x) => a + (x.amount / sum) * C, 0);
    return (
      <circle
        key={s.name}
        cx="50"
        cy="50"
        r={R}
        fill="none"
        stroke={chartColor(i)}
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${C - dash}`}
        strokeDashoffset={-startOffset}
        transform="rotate(-90 50 50)"
      />
    );
  });

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="h-full w-full">
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={stroke}
          />
          {arcs}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-sm font-bold">{money(total)}</div>
          <div className="text-[10px] text-muted-foreground">{centerLabel}</div>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1 text-xs">
        {nonZero.length === 0 && (
          <li className="text-muted-foreground">No spend in this range.</li>
        )}
        {nonZero.map((s, i) => (
          <li key={s.name} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: chartColor(i) }}
              />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {money(s.amount)} · {s.share}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- progress bar (team targets, conversion) ----------

export function ProgressBar({
  pct,
  color = "var(--chart-1)",
}: {
  pct: number | null;
  color?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${clamped}%`, background: color }}
      />
    </div>
  );
}
