"use client";

// Production build of the design-system FilterBox (app/design-system/
// filter-box.tsx): the one date-range dropdown used by every filterable page.
// Picking a preset applies immediately; Custom opens from/to inputs with an
// Apply button inside the menu. Styled with the app theme tokens so it follows
// light/dark mode.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DATE_FILTER_LABELS,
  DATE_FILTER_PRESETS,
  presetRange,
  presetSubLabel,
  type DateFilterPreset,
} from "@/lib/date-filter";

export function DateFilter({
  value,
  from = "",
  to = "",
  onApply,
  showAllTime = false,
  label = "Date range",
  className,
}: {
  value: DateFilterPreset;
  // current custom range — shown in the inputs when value === "custom"
  from?: string;
  to?: string;
  onApply: (preset: DateFilterPreset, from: string, to: string) => void;
  showAllTime?: boolean;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<DateFilterPreset>(value);
  const [custom, setCustom] = useState({ from, to });
  // The menu renders in a portal (position: fixed) so ancestors with
  // overflow-hidden — every Card in this app — can't clip it.
  const [menuPos, setMenuPos] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Re-sync internal state when the page's applied filter changes (URL nav,
  // reset buttons) — adjust-during-render, no effect needed.
  const [prev, setPrev] = useState({ value, from, to });
  if (prev.value !== value || prev.from !== from || prev.to !== to) {
    setPrev({ value, from, to });
    setSelected(value);
    setCustom({ from, to });
  }

  function toggleOpen() {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      const menuWidth = 288; // w-72
      setMenuPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - menuWidth - 8)),
        top: r.bottom + 4,
      });
    }
    setOpen((o) => !o);
  }

  // Click-outside closes the menu and drops any un-applied selection. On
  // scroll/resize the fixed-position menu is re-anchored to the trigger —
  // never closed: focusing a date input can auto-scroll the page, and closing
  // then would kill the menu mid-interaction.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) {
        setOpen(false);
        setSelected(value);
      }
    }
    function reposition() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const menuWidth = 288; // w-72
      setMenuPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - menuWidth - 8)),
        top: r.bottom + 4,
      });
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, value]);

  const options: DateFilterPreset[] = showAllTime
    ? ["all", ...DATE_FILTER_PRESETS]
    : [...DATE_FILTER_PRESETS];

  function pick(p: DateFilterPreset) {
    setSelected(p);
    if (p === "custom") return; // stays open — dates + Apply below
    setOpen(false);
    const r = presetRange(p);
    onApply(p, r.from, r.to);
  }

  function applyCustom() {
    if (!custom.from || !custom.to) return;
    setOpen(false);
    onApply("custom", custom.from, custom.to);
  }

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "inline-flex min-w-[220px] items-center gap-2.5 rounded-lg border bg-card px-3 py-1.5 text-left text-sm transition-colors",
          open
            ? "border-primary ring-2 ring-primary/20"
            : "hover:bg-muted/50"
        )}
      >
        <Calendar className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span className="flex items-baseline gap-2">
            <span className="font-semibold">{DATE_FILTER_LABELS[selected]}</span>
            <span className="truncate text-xs text-muted-foreground">
              {presetSubLabel(selected, custom)}
            </span>
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{ left: menuPos.left, top: menuPos.top }}
            className="fixed z-50 w-72 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
          >
          <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Quick range
          </div>
          {options.map((p) => (
            <button
              key={p}
              type="button"
              role="option"
              aria-selected={selected === p}
              onClick={() => pick(p)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-muted",
                selected === p ? "font-medium text-primary" : ""
              )}
            >
              <span className="flex-1 text-left">{DATE_FILTER_LABELS[p]}</span>
              <span className="text-xs text-muted-foreground">
                {presetSubLabel(p, custom)}
              </span>
              {selected === p && <Check className="h-3 w-3 shrink-0" />}
            </button>
          ))}
          {selected === "custom" && (
            <div className="mt-1 grid gap-2 border-t p-2">
              {/* One input per row — a date input squeezed below its intrinsic
                  width clips its own calendar-picker icon and overlaps its
                  neighbour, which made picking a From date impossible. */}
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-9 shrink-0">From</span>
                <input
                  type="date"
                  value={custom.from}
                  max={custom.to || undefined}
                  onChange={(e) =>
                    setCustom((c) => ({ ...c, from: e.target.value }))
                  }
                  className="min-w-0 flex-1 rounded-md border bg-card px-2 py-1.5 text-sm text-foreground"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-9 shrink-0">To</span>
                <input
                  type="date"
                  value={custom.to}
                  min={custom.from || undefined}
                  onChange={(e) =>
                    setCustom((c) => ({ ...c, to: e.target.value }))
                  }
                  className="min-w-0 flex-1 rounded-md border bg-card px-2 py-1.5 text-sm text-foreground"
                />
              </label>
              <Button
                size="sm"
                onClick={applyCustom}
                disabled={!custom.from || !custom.to}
              >
                Apply
              </Button>
            </div>
          )}
          </div>,
          document.body
        )}
    </div>
  );
}
