"use client";

import Link from "next/link";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { WebPhoto } from "@/components/storefront/web-photo";
import { bag, MAX_QTY, useBag } from "@/lib/storefront/bag-store";
import { copy } from "@/lib/storefront/copy";
import { formatTaka } from "@/lib/storefront/format";
import type { WebBagLine } from "@/lib/storefront/types";
import { useBagLines, useHydrated, type BagNotes } from "./use-bag-lines";

// ROUND3 W-5 — the bag page (/bag). What's saved in the browser, shown as it
// is now: today's price for the chosen options, stock, a quantity stepper.
// Delivery is added at checkout, by the area. Never cached.

export function BagView() {
  const hydrated = useHydrated();
  const entries = useBag();
  const { lines, ready, notes, error, reload } = useBagLines(entries);

  if (!hydrated) return <p className="py-10 text-center text-muted">{copy.bag.loading}</p>;
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <ShoppingBag className="size-12 text-navy-100" strokeWidth={1.5} />
        <p className="text-lg text-ink">{copy.bag.empty}</p>
        <BagNotesView notes={notes} />
        <Link href="/" className="sf-btn sf-btn-navy">
          {copy.bag.browse}
        </Link>
      </div>
    );
  }

  const subtotal = lines.reduce((s, l, i) => s + (l ? l.price * entries[i].qty : 0), 0);
  const blocked = !ready || lines.some((l) => l?.stock === "OUT_OF_STOCK");

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_340px] md:items-start">
      <div className="flex min-w-0 flex-col gap-3">
        <BagNotesView notes={notes} />
        {error ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-card bg-bad-bg p-3 text-[15px] text-bad">
            {copy.bag.error}
            <button type="button" className="sf-btn sf-btn-outline min-h-10 px-4" onClick={reload}>
              {copy.bag.retry}
            </button>
          </div>
        ) : null}
        <ul className="flex flex-col gap-3">
          {entries.map((e, i) => (
            <BagRow key={`${e.kind}-${e.slug}-${i}`} at={i} qty={e.qty} line={lines[i]} slug={e.slug} />
          ))}
        </ul>
      </div>

      <aside className="md:rounded-card md:border md:border-line md:bg-white md:p-4" aria-label={copy.checkout.summary}>
        <div className="sf-sticky-bar">
          <p className="mb-1.5 flex items-baseline justify-between text-[15px]">
            <span className="text-muted">{copy.bag.subtotal}</span>
            <span className="font-display text-xl font-bold text-navy">{ready ? formatTaka(subtotal) : "…"}</span>
          </p>
          <p className="mb-3 hidden text-sm text-muted md:block">{copy.bag.deliveryNote}</p>
          <Link
            href="/checkout"
            aria-disabled={blocked}
            onClick={(ev) => {
              if (blocked) ev.preventDefault();
            }}
            className="sf-btn sf-btn-orange w-full"
          >
            {copy.bag.checkout}
          </Link>
        </div>
        <Link href="/" className="mt-3 hidden min-h-12 items-center justify-center text-[15px] font-semibold text-navy underline-offset-4 hover:underline md:flex">
          {copy.bag.keepShopping}
        </Link>
      </aside>
    </div>
  );
}

export function BagNotesView({ notes }: { notes: BagNotes }) {
  const messages: string[] = [];
  if (notes.gone) messages.push(copy.bag.gone);
  if (notes.changed) messages.push(copy.bag.changed);
  if (notes.priceUpdated) messages.push(copy.bag.priceUpdated);
  if (messages.length === 0) return null;
  return (
    <div role="status" className="flex flex-col gap-1 rounded-card border border-orange-200 bg-orange-50 p-3 text-[15px] text-ink">
      {messages.map((m) => (
        <p key={m}>{m}</p>
      ))}
    </div>
  );
}

function BagRow({ at, qty, line, slug }: { at: number; qty: number; line: WebBagLine | null; slug: string }) {
  if (!line) {
    return <li className="h-28 animate-pulse rounded-card border border-line bg-white" aria-busy="true" />;
  }
  const out = line.stock === "OUT_OF_STOCK";
  return (
    <li className="flex gap-3 rounded-card border border-line bg-white p-3">
      <Link href={`/p/${slug}`} className="sf-photo size-20 shrink-0 rounded-ctl sm:size-24">
        <WebPhoto image={line.image} name={line.name} sizes="96px" showName={false} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link href={`/p/${slug}`} className="font-medium leading-snug text-ink hover:text-navy">
          {line.name}
        </Link>
        {line.choices.length > 0 ? (
          <ul className="text-sm text-muted">
            {line.choices.map((c) => (
              <li key={c.label}>
                {c.label}: <span className="text-body">{c.name}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-sm text-muted">
          {formatTaka(line.price)} {copy.bag.each}
        </p>
        {out ? <p className="text-sm font-semibold text-bad">{copy.bag.outOfStock}</p> : null}
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center rounded-full border-2 border-line-strong" role="group" aria-label={copy.bag.qty}>
            <button
              type="button"
              className="grid size-11 place-items-center rounded-full text-navy disabled:opacity-40"
              aria-label={copy.bag.less(line.name)}
              disabled={qty <= 1}
              onClick={() => bag.setQty(at, qty - 1)}
            >
              <Minus className="size-4" />
            </button>
            <span className="min-w-8 text-center font-semibold text-ink" aria-live="polite">
              {qty}
            </span>
            <button
              type="button"
              className="grid size-11 place-items-center rounded-full text-navy disabled:opacity-40"
              aria-label={copy.bag.more(line.name)}
              disabled={qty >= MAX_QTY}
              onClick={() => bag.setQty(at, qty + 1)}
            >
              <Plus className="size-4" />
            </button>
          </div>
          <span className="font-display text-lg font-bold text-navy">{formatTaka(line.price * qty)}</span>
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-bad"
          aria-label={copy.bag.removeLabel(line.name)}
          onClick={() => bag.remove(at)}
        >
          <Trash2 className="size-4" /> {copy.bag.remove}
        </button>
      </div>
    </li>
  );
}
