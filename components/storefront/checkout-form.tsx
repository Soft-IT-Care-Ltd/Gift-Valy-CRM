"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { WebPhoto } from "@/components/storefront/web-photo";
import { bag, useBag } from "@/lib/storefront/bag-store";
import {
  checkOrderRequest,
  fixedDateRange,
  guessCountry,
  WEB_COUNTRIES,
  zoneDelivery,
  type FieldErrors,
  type OrderRequestInput,
} from "@/lib/storefront/checkout-shape";
import { copy } from "@/lib/storefront/copy";
import { formatTaka } from "@/lib/storefront/format";
import { trackBrowse, trackOrderPlaced, type PixelData } from "@/lib/storefront/meta-pixel";
import { DELIVERY_DATE_MODES, DELIVERY_ZONES, OCCASIONS, RECIPIENT_RELATIONS, type DeliveryZoneValue } from "@/lib/order-constants";
import { BagNotesView } from "./bag-view";
import { useBagLines, useHydrated } from "./use-bag-lines";

// ROUND3 W-5 — the checkout (/checkout): the sender abroad, the recipient in
// Bangladesh, the delivery area and date, an occasion and a note. The same
// checks run here and on the server (lib/storefront/checkout-shape.ts). The
// prices shown are today's (re-read from the server); they are sent back only
// so the server can say "the price just changed" (409) — it prices the order
// itself from the database. No payment here: the SE confirms on WhatsApp.

type Zone = DeliveryZoneValue | "";
type Mode = (typeof DELIVERY_DATE_MODES)[number] | "";

export function CheckoutForm() {
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
  if (error && !ready) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center text-bad">
        {copy.bag.error}
        <button type="button" className="sf-btn sf-btn-outline" onClick={reload}>
          {copy.bag.retry}
        </button>
      </div>
    );
  }
  if (!ready) return <p className="py-10 text-center text-muted">{copy.bag.loading}</p>;
  return <Form lines={lines.map((l) => l!)} notes={notes} reload={reload} />;
}

function Form({
  lines,
  notes,
  reload,
}: {
  lines: NonNullable<ReturnType<typeof useBagLines>["lines"][number]>[];
  notes: ReturnType<typeof useBagLines>["notes"];
  reload: () => void;
}) {
  const router = useRouter();
  const entries = useBag();
  // Rendered only in the browser (after hydration), so the time zone is readable here.
  const [country, setCountry] = useState<string>(() => guessCountry(Intl.DateTimeFormat().resolvedOptions().timeZone));
  const [senderName, setSenderName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [relation, setRelation] = useState("");
  const [address, setAddress] = useState("");
  const [zone, setZone] = useState<Zone>("");
  const [mode, setMode] = useState<Mode>("");
  const [date, setDate] = useState("");
  const [occasion, setOccasion] = useState("");
  const [note, setNote] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [range] = useState(() => fixedDateRange(new Date()));

  const withQty = lines.map((l, i) => ({ ...l, qty: entries[i]?.qty ?? 1 }));
  const items = Math.round(withQty.reduce((s, l) => s + l.price * l.qty, 0) * 100) / 100;
  const delivery = zone ? zoneDelivery(withQty, zone) : null;
  const total = Math.round((items + (delivery ?? 0)) * 100) / 100;
  const outOfStock = withQty.some((l) => l.stock === "OUT_OF_STOCK");
  const dial = WEB_COUNTRIES.find((c) => c.value === country)?.dial ?? null;

  // W-8 — Meta InitiateCheckout, once, when the form opens with a bag (the server prices the lines itself).
  const started = useRef(false);
  useEffect(() => {
    if (started.current || withQty.length === 0) return;
    started.current = true;
    trackBrowse(
      "InitiateCheckout",
      {
        currency: "BDT",
        value: items,
        content_ids: withQty.map((l) => l.slug),
        content_type: "product",
        contents: withQty.map((l) => ({ id: l.slug, quantity: l.qty, item_price: l.price })),
        num_items: withQty.reduce((n, l) => n + l.qty, 0),
      },
      { items: withQty.map((l, i) => ({ kind: entries[i].kind, slug: entries[i].slug, picks: entries[i].picks, qty: l.qty })) }
    );
  }, [withQty, items, entries]);
  const example = WEB_COUNTRIES.find((c) => c.value === country)?.example;

  function payload(): OrderRequestInput {
    return {
      sender: { name: senderName, country: country as OrderRequestInput["sender"]["country"], whatsapp },
      recipient: {
        name: recipientName,
        phone: recipientPhone,
        relation: (relation || null) as OrderRequestInput["recipient"]["relation"],
        address,
        zone: zone as DeliveryZoneValue,
      },
      delivery: { mode: mode as (typeof DELIVERY_DATE_MODES)[number], date: mode === "FIXED" ? date || null : null },
      occasion: (occasion || null) as OrderRequestInput["occasion"],
      note,
      lines: withQty.map((l, i) => ({ kind: entries[i].kind, slug: entries[i].slug, picks: entries[i].picks, qty: l.qty, seenPrice: l.price })),
      seenTotal: total,
      website: honeypot,
    };
  }

  function showErrors(found: FieldErrors) {
    setErrors(found);
    setBanner(copy.checkout.fixErrors);
    requestAnimationFrame(() => {
      const first = formRef.current?.querySelector<HTMLElement>("[aria-invalid='true'], [data-invalid='true'] input");
      first?.focus();
      first?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (sending || outOfStock) return;
    const body = payload();
    const checked = checkOrderRequest(body, new Date());
    if (!checked.ok) return showErrors(checked.errors);
    setErrors({});
    setBanner(null);
    setSending(true);
    try {
      const res = await fetch("/api/shop/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        link?: string;
        error?: string;
        fields?: FieldErrors | null;
        track?: { pixelId: string; event: "Lead"; eventId: string; data: PixelData } | null;
      };
      if (res.status === 201 && data.link) {
        // W-8 — Meta Lead in the browser, with the event_id the server's copy carries.
        trackOrderPlaced(data.track);
        bag.clear();
        router.replace(data.link);
        return;
      }
      if (res.status === 400 && data.fields) {
        setSending(false);
        return showErrors(data.fields);
      }
      // 409: a price, a choice or the stock changed — show today's bag again.
      if (res.status === 409) reload();
      setBanner(data.error ?? copy.api.failed);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setBanner(copy.api.failed);
    }
    setSending(false);
  }

  const err = (key: string) => errors[key];
  /** A field being fixed loses its error at once. */
  const fixed = (key: string) => {
    if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
  };

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="grid gap-6 md:grid-cols-[minmax(0,1fr)_360px] md:items-start">
      <div className="flex min-w-0 flex-col gap-6">
        {banner ? (
          <p role="alert" className="rounded-card bg-bad-bg p-3 text-[15px] font-medium text-bad">
            {banner}
          </p>
        ) : null}
        <BagNotesView notes={notes} />

        <Section title={copy.checkout.sender} hint={copy.checkout.senderHint}>
          <Field id="sender-name" label={copy.checkout.senderName} error={err("sender.name")}>
            <input id="sender-name" className="sf-field" autoComplete="name" value={senderName} onChange={(e) => (setSenderName(e.target.value), fixed("sender.name"))} maxLength={80} {...invalid(err("sender.name"), "sender-name")} />
          </Field>
          <Field id="sender-country" label={copy.checkout.country} error={err("sender.country")}>
            <select id="sender-country" className="sf-field" value={country} onChange={(e) => (setCountry(e.target.value), fixed("sender.country"), fixed("sender.whatsapp"))} {...invalid(err("sender.country"), "sender-country")}>
              <option value="">{copy.checkout.chooseCountry}</option>
              {WEB_COUNTRIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="sender-whatsapp" label={copy.checkout.whatsapp} hint={dial ? copy.checkout.whatsappHint : copy.checkout.whatsappOther} error={err("sender.whatsapp")}>
            <div className="flex items-stretch gap-2">
              {dial ? (
                <span className="grid min-h-12 shrink-0 place-items-center rounded-full bg-navy-50 px-4 font-semibold text-navy" aria-hidden>
                  +{dial}
                </span>
              ) : null}
              <input
                id="sender-whatsapp"
                className="sf-field"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={dial ? example : "+44 7XXX XXXXXX"}
                value={whatsapp}
                onChange={(e) => (setWhatsapp(e.target.value), fixed("sender.whatsapp"))}
                maxLength={30}
                {...invalid(err("sender.whatsapp"), "sender-whatsapp")}
              />
            </div>
          </Field>
        </Section>

        <Section title={copy.checkout.recipient} hint={copy.checkout.recipientHint}>
          <Field id="recipient-name" label={copy.checkout.recipientName} error={err("recipient.name")}>
            <input id="recipient-name" className="sf-field" value={recipientName} onChange={(e) => (setRecipientName(e.target.value), fixed("recipient.name"))} maxLength={80} {...invalid(err("recipient.name"), "recipient-name")} />
          </Field>
          <Field id="recipient-phone" label={copy.checkout.bdPhone} error={err("recipient.phone")}>
            <input
              id="recipient-phone"
              className="sf-field"
              type="tel"
              inputMode="tel"
              placeholder={copy.checkout.bdPhonePlaceholder}
              value={recipientPhone}
              onChange={(e) => (setRecipientPhone(e.target.value), fixed("recipient.phone"))}
              maxLength={30}
              {...invalid(err("recipient.phone"), "recipient-phone")}
            />
          </Field>
          <Field id="recipient-relation" label={copy.checkout.relation}>
            <select id="recipient-relation" className="sf-field" value={relation} onChange={(e) => setRelation(e.target.value)}>
              <option value="">{copy.checkout.relationNone}</option>
              {RECIPIENT_RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field id="recipient-address" label={copy.checkout.address} error={err("recipient.address")}>
            <textarea
              id="recipient-address"
              className="sf-field min-h-24 rounded-card"
              placeholder={copy.checkout.addressPlaceholder}
              autoComplete="street-address"
              value={address}
              onChange={(e) => (setAddress(e.target.value), fixed("recipient.address"))}
              maxLength={300}
              rows={3}
              {...invalid(err("recipient.address"), "recipient-address")}
            />
          </Field>
          <fieldset className="flex flex-col gap-2" data-invalid={!!err("recipient.zone")} aria-describedby={err("recipient.zone") ? "zone-error" : undefined}>
            <legend className="mb-1 font-semibold text-ink">{copy.checkout.zone}</legend>
            {DELIVERY_ZONES.map((z) => {
              const charge = zoneDelivery(withQty, z);
              return (
                <Choice key={z} name="zone" value={z} checked={zone === z} onChange={() => (setZone(z), fixed("recipient.zone"))} invalid={!!err("recipient.zone")}>
                  <span className="flex-1">{copy.checkout.zones[z]}</span>
                  <span className="font-semibold text-navy">{charge > 0 ? formatTaka(charge) : copy.checkout.free}</span>
                </Choice>
              );
            })}
            {err("recipient.zone") ? (
              <p id="zone-error" className="text-sm text-bad">
                {err("recipient.zone")}
              </p>
            ) : null}
          </fieldset>
        </Section>

        <Section title={copy.checkout.date}>
          <fieldset className="flex flex-col gap-2" data-invalid={!!err("delivery.mode")} aria-describedby={err("delivery.mode") ? "mode-error" : undefined}>
            <legend className="sf-visually-hidden">{copy.checkout.date}</legend>
            {DELIVERY_DATE_MODES.map((m) => (
              <Choice key={m} name="mode" value={m} checked={mode === m} onChange={() => (setMode(m), fixed("delivery.mode"), fixed("delivery.date"))} invalid={!!err("delivery.mode")}>
                {copy.checkout.modes[m]}
              </Choice>
            ))}
            {err("delivery.mode") ? (
              <p id="mode-error" className="text-sm text-bad">
                {err("delivery.mode")}
              </p>
            ) : null}
          </fieldset>
          {mode === "FIXED" ? (
            <Field id="delivery-date" label={copy.checkout.pickDate} error={err("delivery.date")}>
              <input id="delivery-date" type="date" className="sf-field" min={range.min} max={range.max} value={date} onChange={(e) => (setDate(e.target.value), fixed("delivery.date"))} {...invalid(err("delivery.date"), "delivery-date")} />
            </Field>
          ) : null}
        </Section>

        <Section title={copy.checkout.extra}>
          <Field id="occasion" label={copy.checkout.occasion}>
            <select id="occasion" className="sf-field" value={occasion} onChange={(e) => setOccasion(e.target.value)}>
              <option value="">{copy.checkout.occasionNone}</option>
              {OCCASIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>
          <Field id="note" label={copy.checkout.note} error={err("note")}>
            <textarea id="note" className="sf-field min-h-24 rounded-card" placeholder={copy.checkout.notePlaceholder} value={note} onChange={(e) => (setNote(e.target.value), fixed("note"))} maxLength={500} rows={3} {...invalid(err("note"), "note")} />
          </Field>
          {/* The honeypot: hidden from people (and screen readers), filled in by bots. */}
          <div className="sf-visually-hidden" aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input id="website" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
          </div>
        </Section>
      </div>

      <aside className="flex flex-col gap-4 rounded-card border border-line bg-white p-4 md:sticky md:top-24" aria-labelledby="summary">
        <h2 id="summary" className="text-xl">
          {copy.checkout.summary}
        </h2>
        <ul className="flex flex-col gap-3">
          {withQty.map((l, i) => (
            <li key={`${l.slug}-${i}`} className="flex gap-3">
              <span className="sf-photo size-14 shrink-0 rounded-ctl">
                <WebPhoto image={l.image} name={l.name} sizes="56px" showName={false} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col text-sm">
                <span className="font-medium text-ink">
                  {l.name} × {l.qty}
                </span>
                {l.choices.map((c) => (
                  <span key={c.label} className="text-muted">
                    {c.label}: {c.name}
                  </span>
                ))}
                {l.stock === "OUT_OF_STOCK" ? <span className="font-semibold text-bad">{copy.bag.outOfStock}</span> : null}
              </span>
              <span className="shrink-0 text-sm font-semibold text-ink">{formatTaka(l.price * l.qty)}</span>
            </li>
          ))}
        </ul>
        <dl className="flex flex-col gap-1 border-t border-line pt-3 text-[15px]">
          <div className="flex justify-between">
            <dt className="text-muted">{copy.checkout.items}</dt>
            <dd>{formatTaka(items)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{copy.checkout.delivery}</dt>
            <dd>{delivery == null ? <span className="text-sm text-muted">{copy.checkout.deliveryPick}</span> : delivery > 0 ? formatTaka(delivery) : copy.checkout.free}</dd>
          </div>
        </dl>
        <p className="rounded-card bg-navy-50 p-3 text-sm text-ink">{copy.checkout.payNote}</p>
        <div className="sf-sticky-bar">
          <p className="mb-1.5 flex items-baseline justify-between">
            <span className="text-muted">{copy.checkout.total}</span>
            <span className="font-display text-2xl font-bold text-navy" aria-live="polite">
              {formatTaka(total)}
            </span>
          </p>
          <button type="submit" className="sf-btn sf-btn-orange w-full" disabled={sending || outOfStock} aria-busy={sending}>
            {sending ? copy.checkout.placing : copy.checkout.place}
          </button>
        </div>
      </aside>
    </form>
  );
}

const invalid = (error: string | undefined, id: string) =>
  error ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : { "aria-invalid": false as const };

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-line bg-white p-4 md:p-5">
      <div>
        <h2 className="text-xl">{title}</h2>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-sm text-muted">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Choice({
  name,
  value,
  checked,
  onChange,
  invalid: bad,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  invalid: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-card border-2 bg-white px-4 py-2 text-[15px] ${
        checked ? "border-navy bg-navy-50" : bad ? "border-bad" : "border-line hover:border-line-strong"
      }`}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="size-5 accent-[var(--color-navy)]" />
      {children}
    </label>
  );
}
