"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { bag, type BagEntry, type BagPicks } from "@/lib/storefront/bag-store";
import type { WebBagLine } from "@/lib/storefront/types";

// ROUND3 W-5 — the bag and the checkout show each saved line as the server
// says it is NOW (POST /api/shop/bag → the catalog gate): today's price for
// its picks, stock, delivery charges. The saved bag is then brought in line
// (lib/storefront/bag-store.ts refresh): gone lines out, today's prices in.

const pickKey = (p: BagPicks) =>
  Object.keys(p)
    .sort()
    .map((k) => `${k}:${p[k]}`)
    .join(",");
const lineKey = (l: { kind: string; slug: string; picks: BagPicks }) => `${l.kind}|${l.slug}|${pickKey(l.picks)}`;

export type BagNotes = { gone: boolean; changed: boolean; priceUpdated: boolean };

const noop = () => () => {};
/** False on the server and during hydration, true after — the bag lives only in the browser. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

export function useBagLines(entries: BagEntry[]) {
  const request = useMemo(
    () => JSON.stringify({ lines: entries.map((e) => ({ kind: e.kind, slug: e.slug, picks: e.picks })) }),
    [entries]
  );
  const [byKey, setByKey] = useState<Map<string, WebBagLine>>(() => new Map());
  const [notes, setNotes] = useState<BagNotes>({ gone: false, changed: false, priceUpdated: false });
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const asked = (JSON.parse(request) as { lines: { kind: string; slug: string; picks: BagPicks }[] }).lines;
    if (asked.length === 0) return;
    let cancelled = false;
    fetch("/api/shop/bag", { method: "POST", headers: { "Content-Type": "application/json" }, body: request, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ lines: (WebBagLine | null)[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (cancelled) return;
        const seen = bag.snapshot();
        setByKey((prev) => {
          const next = new Map(prev);
          asked.forEach((a, i) => {
            const line = data.lines[i];
            if (!line) return;
            next.set(lineKey(a), line);
            next.set(lineKey({ kind: a.kind, slug: a.slug, picks: line.picks }), line);
          });
          return next;
        });
        setNotes((prev) => ({
          gone: prev.gone || data.lines.some((l) => l === null),
          changed: prev.changed || data.lines.some((l) => l?.choicesChanged),
          priceUpdated:
            prev.priceUpdated ||
            data.lines.some((l, i) => l != null && seen[i] != null && Math.round(l.price * 100) !== Math.round(seen[i].seenPrice * 100)),
        }));
        setError(false);
        bag.refresh(data.lines.map((l) => (l ? { picks: l.picks, price: l.price } : null)));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [request, attempt]);

  const lines = entries.map((e) => byKey.get(lineKey(e)) ?? null);
  return {
    lines,
    ready: entries.length > 0 && lines.every((l) => l !== null),
    notes,
    error,
    /** Read again (after a 409 "the price just changed", or a failed load). */
    reload: () => {
      setError(false);
      setAttempt((n) => n + 1);
    },
  };
}
