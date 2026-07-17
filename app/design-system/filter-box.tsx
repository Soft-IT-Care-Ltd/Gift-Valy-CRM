"use client";

// Reusable date-range filter used across the design system.
import { useEffect, useRef, useState } from "react";

type CustomRange = { from: string; to: string };
type Range = { id: string; label: string; hasRange?: boolean };

const FB_RANGES: Range[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "lastmonth", label: "Last Month" },
  { id: "custom", label: "Custom Date", hasRange: true },
];

const FB_ICONS: Record<string, string> = {
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  chev: "m6 9 6 6 6-6",
  check: "M20 6 9 17l-5-5",
};

const FBIcon = ({ name, size = 14 }: { name: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={FB_ICONS[name]} />
  </svg>
);

const fbRangeLabel = (id: string, custom: CustomRange): string => {
  const today = new Date();
  const fmt = (d: Date) => {
    const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
    return `${d.getDate()} ${m}`;
  };
  switch (id) {
    case "today":
      return fmt(today);
    case "yesterday": {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return fmt(d);
    }
    case "week": {
      const s = new Date(today);
      s.setDate(s.getDate() - s.getDay());
      return `${fmt(s)} – ${fmt(today)}`;
    }
    case "month": {
      const s = new Date(today.getFullYear(), today.getMonth(), 1);
      return `${fmt(s)} – ${fmt(today)}`;
    }
    case "lastmonth": {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const e = new Date(today.getFullYear(), today.getMonth(), 0);
      return `${fmt(s)} – ${fmt(e)}`;
    }
    case "custom":
      return custom && custom.from && custom.to ? `${custom.from} → ${custom.to}` : "Pick dates";
    default:
      return "";
  }
};

export function FilterBox({
  value = "today",
  onChange,
  customRange,
  onCustomChange,
  compact = false,
  label = "Date range",
  exclude = [],
}: {
  value?: string;
  onChange?: (id: string) => void;
  customRange?: CustomRange;
  onCustomChange?: (range: CustomRange) => void;
  compact?: boolean;
  label?: string;
  exclude?: string[];
}) {
  const ranges = FB_RANGES.filter((r) => !exclude.includes(r.id));
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(value);
  const [custom, setCustom] = useState<CustomRange>(customRange || { from: "", to: "" });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setSelected(value), [value]);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeRange = ranges.find((r) => r.id === selected) || ranges[0];
  const pick = (id: string) => {
    setSelected(id);
    if (id !== "custom") {
      setOpen(false);
      onChange?.(id);
    } else {
      onChange?.(id);
    }
  };
  const applyCustom = () => {
    if (custom.from && custom.to) {
      onCustomChange?.(custom);
      setOpen(false);
    }
  };

  return (
    <div className={`fb ${compact ? "fb-compact" : ""}`} ref={ref}>
      <button className={`fb-trigger ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)} type="button">
        <FBIcon name="calendar" />
        <div className="fb-trigger-text">
          {!compact && <div className="fb-trigger-label">{label}</div>}
          <div className="fb-trigger-value">
            <span>{activeRange.label}</span>
            <span className="fb-trigger-sub">{fbRangeLabel(selected, custom)}</span>
          </div>
        </div>
        <span className={`fb-chev ${open ? "up" : ""}`}>
          <FBIcon name="chev" size={13} />
        </span>
      </button>
      {open && (
        <div className="fb-menu">
          <div className="fb-menu-label">Quick range</div>
          {ranges.map((r) => (
            <button key={r.id} className={`fb-option ${selected === r.id ? "active" : ""}`} onClick={() => pick(r.id)} type="button">
              <span>{r.label}</span>
              <span className="fb-option-sub">{fbRangeLabel(r.id, custom)}</span>
              {selected === r.id && <FBIcon name="check" size={12} />}
            </button>
          ))}
          {selected === "custom" && (
            <div className="fb-custom">
              <div className="fb-custom-row">
                <label>
                  <span>From</span>
                  <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                </label>
                <label>
                  <span>To</span>
                  <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
                </label>
              </div>
              <button className="fb-apply" onClick={applyCustom} type="button" disabled={!custom.from || !custom.to}>
                Apply
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
