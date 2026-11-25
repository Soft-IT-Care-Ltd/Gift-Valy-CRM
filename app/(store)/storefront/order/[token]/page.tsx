import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Camera, Check, CircleCheck, CircleX, Truck } from "lucide-react";
import { ChatButtons } from "@/components/storefront/chat-buttons";
import { cachedSettings } from "@/lib/storefront/cached";
import { fillTemplate } from "@/lib/storefront/chat";
import { copy } from "@/lib/storefront/copy";
import { formatTaka } from "@/lib/storefront/format";
import { websiteOrderByToken, type WebOrderReceipt } from "@/lib/storefront/place-order";

// ROUND3 W-5 — the customer's confirmation page, reached only by its private
// link (/order/<token>). The reference (never the DRAFT number: those are
// reused), what they ordered, the money, where the order is now and — once
// shipped — the Steadfast tracking link. No name, phone number or address.
// Never cached, never indexed.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.order.title, robots: { index: false, follow: false } };

export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const order = await websiteOrderByToken((await params).token);
  if (!order) notFound();
  const settings = await cachedSettings();
  const message = fillTemplate(copy.order.whatsAppMessage, { order_ref: order.number ? `${order.ref} / ${order.number}` : order.ref, total: formatTaka(order.total) });
  const cancelled = order.state === "CANCELLED";

  return (
    <div className="sf-container max-w-2xl pt-8 pb-12">
      <div className="flex flex-col items-center gap-3 text-center">
        {cancelled ? <CircleX className="size-12 text-bad" strokeWidth={1.75} /> : <CircleCheck className="size-12 text-ok" strokeWidth={1.75} />}
        <h1 className="text-3xl">{cancelled ? copy.order.cancelled : copy.order.thanks}</h1>
        <p className="text-muted">
          {copy.order.reference} <span className="font-display text-xl font-bold text-navy">{order.ref}</span>
        </p>
        {order.number ? (
          <p className="text-muted">
            {copy.order.number} <span className="font-semibold text-ink">{order.number}</span>
          </p>
        ) : null}
        {order.state === "WAITING" ? <p className="text-lg text-ink">{copy.order.callToConfirm}</p> : null}
      </div>

      {order.photos > 0 || order.cards > 0 ? (
        <div className="mt-6 flex gap-3 rounded-card border border-orange-200 bg-orange-50 p-4 text-[15px] text-ink">
          <Camera className="mt-0.5 size-5 shrink-0 text-orange-text" />
          <div className="flex flex-col gap-1">
            {order.photos > 0 ? <p className="font-semibold">{copy.product.photosNote(order.photos)}</p> : null}
            {order.cards > 0 ? <p>{copy.product.cardsNote(order.cards)}</p> : null}
          </div>
        </div>
      ) : null}

      {!cancelled ? <Steps order={order} /> : null}

      <section className="mt-6 rounded-card border border-line bg-white p-4" aria-labelledby="order-details">
        <h2 id="order-details" className="mb-3 text-lg">
          {copy.order.details}
        </h2>
        <ul className="flex flex-col gap-3 text-[15px]">
          {order.items.map((i, n) => (
            <li key={n} className="flex justify-between gap-3">
              <span className="min-w-0">
                <span className="text-ink">
                  {i.name} × {i.qty}
                </span>
                {i.choices.map((c) => (
                  <span key={c.label} className="block text-sm text-muted">
                    {c.label}: {c.name}
                  </span>
                ))}
              </span>
              <span className="shrink-0">{formatTaka(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-[15px]">
          {order.discount > 0 ? (
            <Row label={copy.order.discount} value={`− ${formatTaka(order.discount)}`} />
          ) : null}
          <Row
            label={copy.order.delivery(order.zone ? copy.checkout.zones[order.zone] : copy.checkout.delivery)}
            value={order.delivery > 0 ? formatTaka(order.delivery) : copy.checkout.free}
          />
          <Row label={copy.order.total} value={formatTaka(order.total)} strong />
          {order.paid > 0 ? (
            <>
              <Row label={copy.order.paid} value={formatTaka(order.paid)} />
              <Row label={order.due > 0 ? copy.order.due : copy.order.paidInFull} value={order.due > 0 ? formatTaka(order.due) : "✓"} strong />
            </>
          ) : null}
        </dl>
      </section>

      <p className="mt-4 text-center text-sm text-muted">{copy.order.keepLink}</p>

      {settings.whatsapp || settings.messengerPage ? (
        <section className="mt-6 flex flex-col gap-3" aria-labelledby="order-chat">
          <h2 id="order-chat" className="text-center text-lg">
            {copy.order.questions}
          </h2>
          <ChatButtons
            whatsapp={settings.whatsapp}
            messengerPage={settings.messengerPage}
            message={message}
            labels={{ whatsapp: copy.chat.askWhatsApp, messenger: copy.chat.askMessenger }}
          />
        </section>
      ) : null}

      <div className="mt-6 flex justify-center">
        <Link href="/" className="sf-btn sf-btn-outline">
          {copy.order.shopMore}
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "text-[17px] font-semibold text-ink" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Confirmed → Packed → Shipped → Delivered, with the step the order is at. */
function Steps({ order }: { order: WebOrderReceipt }) {
  return (
    <section className="mt-6 rounded-card border border-line bg-white p-4" aria-labelledby="order-status">
      <h2 id="order-status" className="text-lg">
        {copy.order.status}
      </h2>
      <ol className="mt-3 grid grid-cols-4 gap-1">
        {copy.order.steps.map((step, n) => {
          const done = n < order.stepsDone;
          const now = n === order.stepsDone - 1;
          return (
            <li key={step} className="flex flex-col items-center gap-1.5 text-center">
              <span className="flex w-full items-center" aria-hidden>
                <span className={`h-0.5 flex-1 ${n === 0 ? "opacity-0" : done ? "bg-navy" : "bg-line"}`} />
                <span className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 ${done ? "border-navy bg-orange text-navy" : "border-line bg-white text-muted"}`}>
                  {done ? <Check className="size-4" strokeWidth={3} /> : <span className="text-xs font-semibold">{n + 1}</span>}
                </span>
                <span className={`h-0.5 flex-1 ${n === copy.order.steps.length - 1 ? "opacity-0" : n + 1 < order.stepsDone ? "bg-navy" : "bg-line"}`} />
              </span>
              <span className={`text-[13px] leading-tight ${done ? "font-semibold text-ink" : "text-muted"}`}>
                {step}
                <span className="sf-visually-hidden">{done ? ` — ${now ? copy.order.stepNow : copy.order.stepDone}` : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {order.state === "WAITING" ? <p className="mt-3 text-center text-[15px] text-muted">{copy.order.waiting}</p> : null}
      {order.state === "RETURNED" ? <p className="mt-3 rounded-card bg-bad-bg px-3 py-2 text-center text-[15px] text-ink">{copy.order.returned}</p> : null}
      {order.trackingLink ? (
        <div className="mt-4 flex justify-center">
          <a href={order.trackingLink} target="_blank" rel="noopener noreferrer" className="sf-btn sf-btn-outline">
            <Truck className="size-4" aria-hidden />
            {copy.order.track}
          </a>
        </div>
      ) : null}
    </section>
  );
}
