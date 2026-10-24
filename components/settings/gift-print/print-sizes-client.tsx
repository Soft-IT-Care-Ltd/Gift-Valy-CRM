"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  A4_MM,
  DEFAULT_PRINT_SIZES,
  PRINT_LAYOUTS,
  PRINT_LAYOUT_IDS,
  PRINT_SLOTS,
  PRINT_SLOT_LABELS,
  checkLayout,
  layoutSlotCounts,
  mmToPx,
  placedBoxes,
  type PrintLayoutId,
  type PrintSettings,
  type PrintSizes,
} from "@/lib/print-layouts";

// PHOTO_PRINT.md PP-1 — the four piece sizes and the A4 layout. The layout
// preview and its check run live on the unsaved numbers; the server runs the
// same check again and refuses a save that doesn't fit the chosen layout.

type SizeDraft = Record<string, { w: string; h: string }>;

function toDraft(sizes: PrintSizes): SizeDraft {
  return Object.fromEntries(
    PRINT_SLOTS.map((s) => [s, { w: String(sizes[s].w), h: String(sizes[s].h) }])
  );
}

function fromDraft(d: SizeDraft): PrintSizes {
  return Object.fromEntries(
    PRINT_SLOTS.map((s) => [s, { w: Number(d[s].w) || 0, h: Number(d[s].h) || 0 }])
  ) as PrintSizes;
}

const SLOT_FILL: Record<string, string> = {
  PHOTO_L: "fill-primary/15 stroke-primary/60",
  PHOTO_S: "fill-primary/25 stroke-primary/60",
  CARD_1: "fill-amber-400/25 stroke-amber-600/70",
  CARD_2: "fill-amber-400/25 stroke-amber-600/70",
};

export function PrintSizesClient({ initial }: { initial: PrintSettings }) {
  const router = useRouter();
  const [draft, setDraft] = useState<SizeDraft>(toDraft(initial.sizes));
  const [layoutId, setLayoutId] = useState<PrintLayoutId>(initial.layout);
  const [busy, setBusy] = useState(false);
  const [serverProblems, setServerProblems] = useState<string[]>([]);

  const sizes = fromDraft(draft);
  const layout = PRINT_LAYOUTS[layoutId];
  const counts = layoutSlotCounts(layout);
  const problems = useMemo(() => checkLayout(layout, sizes), [layout, sizes]);
  const problemPages = new Set(problems.map((p) => p.page));

  function set(slot: string, dim: "w" | "h", v: string) {
    setDraft((d) => ({ ...d, [slot]: { ...d[slot], [dim]: v } }));
    setServerProblems([]);
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/print", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sizes, layout: layoutId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setServerProblems(body.problems ?? []);
        throw new Error(body.error ?? "Could not save");
      }
      setDraft(toDraft(body.settings.sizes));
      toast.success("Print settings saved");
      if (body.warnings) {
        toast.warning(
          `Note: with these sizes "${body.warnings.layout}" no longer fits (${body.warnings.problems.length} problem${body.warnings.problems.length > 1 ? "s" : ""}).`
        );
      }
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Piece sizes</CardTitle>
            <CardDescription>
              Exact print size of each piece in millimetres (one decimal). Pieces are never scaled
              to fit the page — a size that doesn&apos;t fit the layout is refused.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_7.5rem]">
              <span>Piece</span>
              <span>Width mm</span>
              <span>Height mm</span>
              <span className="hidden sm:block">At 300 DPI</span>
            </div>
            {PRINT_SLOTS.map((slot) => (
              <div
                key={slot}
                className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_7.5rem]"
              >
                <div className="text-sm">
                  {PRINT_SLOT_LABELS[slot]}
                  <span className="block text-xs text-muted-foreground">×{counts[slot]} per box</span>
                </div>
                <Input
                  aria-label={`${PRINT_SLOT_LABELS[slot]} width (mm)`}
                  type="number"
                  step="0.1"
                  value={draft[slot].w}
                  onChange={(e) => set(slot, "w", e.target.value)}
                />
                <Input
                  aria-label={`${PRINT_SLOT_LABELS[slot]} height (mm)`}
                  type="number"
                  step="0.1"
                  value={draft[slot].h}
                  onChange={(e) => set(slot, "h", e.target.value)}
                />
                <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
                  {mmToPx(sizes[slot].w)} × {mmToPx(sizes[slot].h)} px
                </span>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(toDraft(DEFAULT_PRINT_SIZES));
                setServerProblems([]);
              }}
            >
              Reset to the measured sizes
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Layout</CardTitle>
            <CardDescription>
              How the pieces sit on A4 photo paper. Print at 100% / Actual size — never &ldquo;Fit
              to page&rdquo;.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {PRINT_LAYOUT_IDS.map((id) => {
              const l = PRINT_LAYOUTS[id];
              const selected = id === layoutId;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setLayoutId(id);
                    setServerProblems([]);
                  }}
                  className={`w-full rounded-md border p-3 text-left transition-colors ${
                    selected ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  }`}
                  aria-pressed={selected}
                >
                  <div className="text-sm font-medium">{l.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {l.pages.length} A4 pages · {l.gap} mm cutting gap
                    {l.borderless
                      ? " · only if the printer prints borderless WITHOUT enlarging — check one test print with a ruler first (বর্ডারলেস প্রিন্টার, এনলার্জ ছাড়া)"
                      : " · works on any printer (যেকোনো প্রিন্টারে)"}
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {(problems.length > 0 || serverProblems.length > 0) && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">These sizes don&apos;t fit this layout:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-destructive">
              {(serverProblems.length ? serverProblems : problems.map((p) => p.message)).map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        <Button onClick={save} disabled={busy || problems.length > 0}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Preview — {layout.label}</p>
        <div className="grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3">
          {layout.pages.map((page, i) => (
            <figure key={i} className="space-y-1">
              <svg
                viewBox={`0 0 ${A4_MM.w} ${A4_MM.h}`}
                className={`w-full rounded-sm border bg-white shadow-sm ${
                  problemPages.has(i + 1) ? "ring-2 ring-destructive" : ""
                }`}
                role="img"
                aria-label={`Page ${i + 1} of ${layout.pages.length}`}
              >
                {placedBoxes(page, sizes).map((b, j) => {
                  const piece = page.pieces[j];
                  const cls = piece ? SLOT_FILL[piece.slot] : "fill-none stroke-slate-400";
                  return (
                    <g key={j}>
                      <rect
                        x={b.x}
                        y={b.y}
                        width={b.w}
                        height={b.h}
                        className={cls}
                        strokeWidth={0.6}
                        strokeDasharray={piece ? undefined : "2 1.5"}
                      />
                      <text
                        x={b.x + b.w / 2}
                        y={b.y + b.h / 2}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={piece ? (b.w < 50 ? 6 : 9) : 6}
                        className="fill-slate-600"
                      >
                        {piece ? b.name : "Info"}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <figcaption className="text-center text-xs text-muted-foreground">
                Page {i + 1}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
