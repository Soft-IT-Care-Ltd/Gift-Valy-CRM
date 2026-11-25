"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check } from "lucide-react";
import { ChatButtons } from "@/components/storefront/chat-buttons";
import { WebPhoto } from "@/components/storefront/web-photo";
import { bag } from "@/lib/storefront/bag-store";
import { trackBrowse } from "@/lib/storefront/meta-pixel";
import { fillTemplate } from "@/lib/storefront/chat";
import { copy } from "@/lib/storefront/copy";
import { formatApprox, formatExtra, formatTaka } from "@/lib/storefront/format";
import { initialPicks, liveKit, liveStock, liveTotal, pickedOption, picksText, type Picks } from "@/lib/storefront/picks";
import type { WebChoiceGroup, WebContentsLine, WebCurrency, WebStock } from "@/lib/storefront/types";

// ROUND3 W-4 — everything on the product / package page that follows the
// customer's choices: the live total, availability, the choice pickers (each
// option with its photo and extra price), the print-kit note, Add to bag /
// Buy now (pinned to the bottom of a phone screen), Order on WhatsApp /
// Messenger with the choices in the message, and "What's inside" showing
// the current picks. The total is the gate's price plus the picks' deltas,
// both from packagePrice() (lib/storefront/picks.ts).

export type PurchaseItem = {
  kind: "product" | "package";
  slug: string;
  name: string;
  price: number;
  compareAtPrice: number | null;
  stock: WebStock;
  choiceGroups: WebChoiceGroup[];
  contents: WebContentsLine[] | null;
  printPhotos: number;
  printCards: number;
};

export type PurchaseChat = { whatsapp: string; messengerPage: string; template: string; link: string };

const CURRENCY_KEY = "giftvaly-currency";

export function ItemPurchase({ item, chat, currencies }: { item: PurchaseItem; chat: PurchaseChat | null; currencies: WebCurrency[] | null }) {
  const router = useRouter();
  const groups = item.choiceGroups;
  const [picks, setPicks] = useState<Picks>(() => initialPicks(groups));
  const [added, setAdded] = useState(false);
  const total = liveTotal(item.price, groups, picks);
  const stock = liveStock(item.stock, groups, picks);
  const kit = liveKit({ photos: item.printPhotos, cards: item.printCards }, groups, picks);
  const out = stock === "OUT_OF_STOCK";
  const compareAt = item.compareAtPrice && item.compareAtPrice > total ? item.compareAtPrice : null;

  const message = chat
    ? fillTemplate(chat.template, { product: item.name, choices: picksText(groups, picks), price: formatTaka(total), link: chat.link })
    : "";

  function add(): boolean {
    if (out) return false;
    const chosen = Object.fromEntries(Object.entries(picks).map(([k, v]) => [k, v]));
    bag.add({ kind: item.kind, slug: item.slug, picks: chosen, seenPrice: total });
    // W-8 — Meta AddToCart: the server re-prices this line with its picks from the database.
    trackBrowse(
      "AddToCart",
      { currency: "BDT", value: total, content_ids: [item.slug], content_type: "product", contents: [{ id: item.slug, quantity: 1, item_price: total }], num_items: 1 },
      { items: [{ kind: item.kind, slug: item.slug, picks: chosen, qty: 1 }] }
    );
    return true;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="flex flex-wrap items-baseline gap-x-3 font-display text-[30px] leading-tight font-bold text-navy" aria-live="polite">
          {formatTaka(total)}
          {compareAt ? (
            <s className="font-sans text-lg font-normal text-muted">
              <span className="sf-visually-hidden">{copy.product.was} </span>
              {formatTaka(compareAt)}
            </s>
          ) : null}
        </p>
        {currencies ? <ApproxPrice taka={total} currencies={currencies} /> : null}
        <p className={`mt-1 text-[15px] font-semibold ${out ? "text-bad" : "text-ok"}`}>● {copy.stock[stock]}</p>
      </div>

      {groups.map((g) => (
        <fieldset key={g.key} className="flex flex-col gap-2">
          <legend className="mb-2 font-display text-lg font-semibold text-navy">
            {g.label}
            {g.path.length > 0 ? <span className="ml-2 font-sans text-sm font-normal text-muted">{copy.product.inside(g.path.join(" › "))}</span> : null}
          </legend>
          {g.qty > 1 ? <p className="-mt-1 text-sm text-muted">{copy.product.perPiece(g.qty)}</p> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {g.options.map((o) => {
              const optionOut = o.stock === "OUT_OF_STOCK";
              const on = pickedOption(g, picks)?.key === o.key;
              const extra = formatExtra(o.extraPrice);
              return (
                <label
                  key={o.key}
                  className={`relative flex min-h-16 items-center gap-3 rounded-card border-2 bg-white p-2 pr-10 ${
                    optionOut ? "cursor-not-allowed border-line opacity-55" : on ? "cursor-pointer border-navy bg-navy-50" : "cursor-pointer border-line hover:border-line-strong"
                  }`}
                >
                  <input
                    type="radio"
                    name={`choice-${g.key}`}
                    value={o.key}
                    checked={on}
                    disabled={optionOut}
                    onChange={() => {
                      setPicks((p) => ({ ...p, [g.key]: o.key }));
                      setAdded(false);
                    }}
                    className="sf-visually-hidden"
                    aria-label={optionOut ? copy.product.optionOutLabel(o.name) : `${o.name}${extra ? ` (${extra})` : ""}`}
                  />
                  <span className="sf-photo size-12 shrink-0 rounded-ctl">
                    <WebPhoto image={o.image} name={o.name} sizes="48px" showName={false} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className={`text-[15px] leading-snug font-medium text-ink ${optionOut ? "line-through" : ""}`}>{o.name}</span>
                    <span className={`text-sm ${optionOut ? "text-bad" : extra ? "font-semibold text-orange-text" : "text-muted"}`}>
                      {optionOut ? copy.product.optionOut : (extra ?? copy.product.included)}
                    </span>
                  </span>
                  {on && !optionOut ? (
                    <span className="absolute top-1/2 right-3 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-navy text-white">
                      <Check className="size-4" strokeWidth={3} />
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      {kit.photos > 0 || kit.cards > 0 ? (
        <div className="flex gap-3 rounded-card border border-orange-200 bg-orange-50 p-4 text-[15px] text-ink">
          <Camera className="mt-0.5 size-5 shrink-0 text-orange-text" />
          <div className="flex flex-col gap-1">
            {kit.photos > 0 ? <p className="font-semibold">{copy.product.photosNote(kit.photos)}</p> : null}
            {kit.cards > 0 ? <p>{copy.product.cardsNote(kit.cards)}</p> : null}
          </div>
        </div>
      ) : null}

      {out ? <p className="rounded-card bg-bad-bg p-3 text-[15px] text-bad">{copy.product.outOfStock}</p> : null}
      {added ? (
        <p role="status" className="text-[15px] text-ok">
          {copy.product.added}{" "}
          <a href="/bag" className="inline-flex min-h-12 items-center font-semibold underline underline-offset-4">
            {copy.product.viewBag}
          </a>
        </p>
      ) : null}

      <div className="sf-sticky-bar">
        <p className="mb-1.5 flex items-baseline justify-between text-sm text-muted md:hidden">
          <span>{copy.product.total}</span>
          <span className="font-display text-lg font-bold text-navy">{formatTaka(total)}</span>
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="sf-btn sf-btn-outline px-2"
            disabled={out}
            onClick={() => {
              if (add()) setAdded(true);
            }}
          >
            {copy.product.addToBag}
          </button>
          <button
            type="button"
            className="sf-btn sf-btn-orange px-2"
            disabled={out}
            onClick={() => {
              if (add()) router.push("/checkout");
            }}
          >
            {copy.product.buyNow}
          </button>
        </div>
      </div>

      {chat ? <ChatButtons whatsapp={chat.whatsapp} messengerPage={chat.messengerPage} message={message} /> : null}

      {item.contents && item.contents.length > 0 ? (
        <section className="rounded-card border border-line bg-white p-4" aria-labelledby="whats-inside">
          <h2 id="whats-inside" className="mb-2 text-xl">
            {copy.product.whatsInside}
          </h2>
          <Contents lines={item.contents} groups={groups} picks={picks} />
        </section>
      ) : null}
    </div>
  );
}

function Contents({ lines, groups, picks }: { lines: WebContentsLine[]; groups: WebChoiceGroup[]; picks: Picks }) {
  return (
    <ul className="flex flex-col gap-1.5 text-[15px]">
      {lines.map((l, i) => {
        const group = l.groupKey != null ? groups.find((g) => g.key === l.groupKey) : undefined;
        const picked = group ? pickedOption(group, picks)?.name : undefined;
        return (
          <li key={i}>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 inline-block min-w-9 shrink-0 rounded-full bg-navy-50 px-2 text-center text-sm font-semibold text-navy">{l.qty}×</span>
              <span>
                <span className="text-ink">{l.name}</span>
                {l.choice && picked ? <span className="text-muted"> — {copy.product.yourChoice(picked)}</span> : null}
              </span>
            </div>
            {l.children.length > 0 ? (
              <div className="mt-1.5 ml-4 border-l-2 border-line pl-3">
                <Contents lines={l.children} groups={groups} picks={picks} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** "≈ SAR 120 (approx.)" in the visitor's chosen currency — only while Settings → Website switches it on. */
function ApproxPrice({ taka, currencies }: { taka: number; currencies: WebCurrency[] }) {
  const [code, setCode] = useState("");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(CURRENCY_KEY) ?? "";
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the page is cached: the visitor's choice is only readable in the browser
      if (currencies.some((c) => c.iso === saved)) setCode(saved);
    } catch {
      // storage blocked — Taka only
    }
  }, [currencies]);
  const currency = useMemo(() => currencies.find((c) => c.iso === code) ?? null, [currencies, code]);
  if (currencies.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
      {currency ? (
        <span>
          {formatApprox(taka, currency)} <span className="text-xs">({copy.product.approxNote})</span>
        </span>
      ) : null}
      <label className="inline-flex min-h-12 items-center gap-2">
        <span>{copy.product.showIn}</span>
        <select
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            try {
              window.localStorage.setItem(CURRENCY_KEY, e.target.value);
            } catch {
              // kept for this visit
            }
          }}
          className="min-h-10 rounded-full border border-line-strong bg-white px-3 text-sm text-ink"
        >
          <option value="">{copy.product.takaOnly}</option>
          {currencies.map((c) => (
            <option key={c.iso} value={c.iso}>
              {c.iso}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
