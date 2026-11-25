"use client";

import { useSyncExternalStore } from "react";

// ROUND3 W-4 — the bag lives in the visitor's browser (no account): what
// she picked — the item, its choices, the quantity — and the price she saw,
// nothing else. Names, photos, prices and stock are read fresh from the
// server when the bag and checkout open (W-5), and the order endpoint prices
// from the database; the seen price only lets it say "the price just
// changed". Storage may be missing or throw (private mode): the bag then
// lasts for the visit.

export type BagPicks = Record<string, number>; // choice group key → option key
export type BagEntry = {
  kind: "product" | "package";
  slug: string;
  picks: BagPicks;
  qty: number;
  /** The unit price shown when it was added (৳). */
  seenPrice: number;
};

const KEY = "giftvaly-bag-v1";
const MAX_LINES = 30;
export const MAX_QTY = 20;

let memory: BagEntry[] | null = null;
const listeners = new Set<() => void>();

const sameLine = (a: Pick<BagEntry, "kind" | "slug" | "picks">, b: Pick<BagEntry, "kind" | "slug" | "picks">) =>
  a.kind === b.kind && a.slug === b.slug && pickKey(a.picks) === pickKey(b.picks);
const pickKey = (p: BagPicks) =>
  Object.keys(p)
    .sort()
    .map((k) => `${k}:${p[k]}`)
    .join(",");

function valid(e: unknown): e is BagEntry {
  if (!e || typeof e !== "object") return false;
  const x = e as Record<string, unknown>;
  return (
    (x.kind === "product" || x.kind === "package") &&
    typeof x.slug === "string" &&
    /^[a-z0-9-]{1,80}$/.test(x.slug) &&
    Number.isInteger(x.qty) &&
    (x.qty as number) > 0 &&
    typeof x.seenPrice === "number" &&
    !!x.picks &&
    typeof x.picks === "object" &&
    Object.values(x.picks as object).every((v) => Number.isInteger(v))
  );
}

function read(): BagEntry[] {
  if (memory) return memory;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    memory = Array.isArray(parsed)
      ? parsed.filter(valid).map((e) => ({ ...e, qty: Math.min(MAX_QTY, e.qty) })).slice(0, MAX_LINES)
      : [];
  } catch {
    memory = [];
  }
  return memory;
}

function write(next: BagEntry[]) {
  memory = next.slice(0, MAX_LINES);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Kept in memory for this visit.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      memory = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: BagEntry[] = [];

export function useBag(): BagEntry[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function useBagCount(): number {
  return useBag().reduce((sum, e) => sum + e.qty, 0);
}

export const bag = {
  /** The saved lines right now (outside React). */
  snapshot(): BagEntry[] {
    return read();
  },
  add(line: Omit<BagEntry, "qty">, qty = 1) {
    const current = read();
    const existing = current.find((e) => sameLine(e, line));
    write(
      existing
        ? current.map((e) => (e === existing ? { ...e, qty: Math.min(MAX_QTY, e.qty + qty), seenPrice: line.seenPrice } : e))
        : [...current, { ...line, qty: Math.min(MAX_QTY, qty) }]
    );
  },
  /** ROUND3 W-5 — the bag page's stepper: qty 0 removes the line. */
  setQty(at: number, qty: number) {
    const current = read();
    if (!current[at]) return;
    write(qty <= 0 ? current.filter((_, i) => i !== at) : current.map((e, i) => (i === at ? { ...e, qty: Math.min(MAX_QTY, qty) } : e)));
  },
  remove(at: number) {
    write(read().filter((_, i) => i !== at));
  },
  /**
   * ROUND3 W-5 — after the bag / checkout re-read the lines from the server:
   * drop what's gone, take today's price and picks (a pick no longer offered
   * became the group's default), merge lines that became the same.
   */
  refresh(lines: ({ picks: BagPicks; price: number } | null)[]) {
    const current = read();
    const next: BagEntry[] = [];
    current.forEach((e, i) => {
      const now = lines[i];
      if (!now) return;
      const updated = { ...e, picks: now.picks, seenPrice: now.price };
      const same = next.find((x) => sameLine(x, updated));
      if (same) same.qty = Math.min(MAX_QTY, same.qty + updated.qty);
      else next.push(updated);
    });
    const changed =
      next.length !== current.length ||
      next.some((e, i) => e.seenPrice !== current[i].seenPrice || pickKey(e.picks) !== pickKey(current[i].picks) || e.qty !== current[i].qty);
    if (changed) write(next);
  },
  clear() {
    write([]);
  },
};
