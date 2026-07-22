"use client";

// §2.3 — type-ahead item picker for the order form: one input that searches
// products/packages by name OR SKU/code as you type. Replaces the plain
// scroll-only <Select> that made big catalogs unusable.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ComboOption {
  value: string;
  label: string; // item name
  code: string; // SKU / package code — searched and shown
  hint?: string; // right-aligned extra (price, availability)
}

export function ItemCombobox({
  options,
  value,
  onSelect,
  placeholder = "Search…",
}: {
  options: ComboOption[];
  value: string;
  onSelect: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // The menu renders in a portal (position: fixed) so ancestors with
  // overflow-hidden — every Card in this app — can't clip it.
  const [menuPos, setMenuPos] = useState({ left: 0, top: 0, width: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(q) || o.code.toLowerCase().includes(q)
      )
    : options;

  function reposition() {
    const r = inputRef.current?.getBoundingClientRect();
    if (!r) return;
    setMenuPos({ left: r.left, top: r.bottom + 4, width: r.width });
  }

  function openMenu() {
    reposition();
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  // Click-outside closes; scroll/resize re-anchors the fixed menu (same
  // behavior as the shared DateFilter dropdown).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!inputRef.current?.contains(t) && !menuRef.current?.contains(t)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  function pick(v: string) {
    onSelect(v);
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[active]) pick(filtered[active].value);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={open ? query : (selected?.label ?? "")}
        placeholder={selected && !open ? selected.label : placeholder}
        onFocus={openMenu}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          if (!open) openMenu();
        }}
        onKeyDown={onKeyDown}
        className={cn("pr-8", !selected && !open && "text-muted-foreground")}
      />
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              left: menuPos.left,
              top: menuPos.top,
              width: Math.max(menuPos.width, 260),
            }}
            className="fixed z-50 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            {filtered.length === 0 && (
              <div className="px-2.5 py-2 text-sm text-muted-foreground">
                No match for “{query}”.
              </div>
            )}
            {filtered.map((o, i) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                // mousedown beats the input's blur — click always lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o.value);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm",
                  i === active && "bg-muted",
                  o.value === value && "font-medium text-primary"
                )}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {o.code}
                </span>
                {o.hint && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {o.hint}
                  </span>
                )}
                {o.value === value && <Check className="h-3 w-3 shrink-0" />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
