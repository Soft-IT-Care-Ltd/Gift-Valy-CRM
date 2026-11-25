"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/storefront/copy";
import { messengerLink, whatsappLink } from "@/lib/storefront/chat";

// ROUND3 W-4 — "Order on WhatsApp" (green, full width on a phone) and
// "Order on Messenger", with the message prefilled: the product, the chosen
// options, the price and the link. Plain links, so the phone opens the app.
// Messenger doesn't always take the text, so it's also copied first and a
// toast says to paste it. A button whose number / page isn't set in
// Settings → Website isn't shown.
export function ChatButtons({
  whatsapp,
  messengerPage,
  message,
  labels = { whatsapp: copy.chat.orderWhatsApp, messenger: copy.chat.orderMessenger },
}: {
  whatsapp: string;
  messengerPage: string;
  message: string;
  /** W-5 — the confirmation page says "Message us…" instead of "Order on…". */
  labels?: { whatsapp: string; messenger: string };
}) {
  const [toast, setToast] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  if (!whatsapp && !messengerPage) return null;

  return (
    <div className="grid gap-2">
      {whatsapp ? (
        <a href={whatsappLink(whatsapp, message)} target="_blank" rel="noopener" className="sf-btn sf-btn-whatsapp w-full">
          <WhatsAppIcon />
          {labels.whatsapp}
        </a>
      ) : null}
      {messengerPage ? (
        <a
          href={messengerLink(messengerPage, message)}
          target="_blank"
          rel="noopener"
          className="sf-btn sf-btn-messenger w-full"
          onClick={() => {
            copyText(message);
            setToast(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setToast(false), 6000);
          }}
        >
          <MessengerIcon />
          {labels.messenger}
        </a>
      ) : null}
      {toast ? (
        <p role="status" className="fixed inset-x-4 bottom-32 z-50 mx-auto max-w-sm rounded-card bg-navy px-4 py-3 text-center text-[15px] text-white shadow-lg md:bottom-8">
          {copy.chat.copied}
        </p>
      ) : null}
    </div>
  );
}

function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
      return;
    }
  } catch {
    // fall through
  }
  legacyCopy(text);
}

/** Plain http:// and older browsers have no async clipboard. */
function legacyCopy(text: string) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand("copy");
  } catch {
    // the toast still says what to do
  }
  area.remove();
}

// Icons: Simple Icons (CC0).
function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 shrink-0" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

function MessengerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 shrink-0" fill="currentColor">
      <path d="M.001 11.639C.001 4.949 5.241 0 12.001 0S24 4.95 24 11.639c0 6.689-5.24 11.638-12 11.638-1.21 0-2.38-.16-3.47-.46a.96.96 0 00-.64.05l-2.39 1.05a.96.96 0 01-1.35-.85l-.07-2.14a.97.97 0 00-.32-.68A11.39 11.389 0 01.002 11.64zm8.32-2.19l-3.52 5.6c-.35.53.32 1.139.82.75l3.79-2.87c.26-.2.6-.2.87 0l2.8 2.1c.84.63 2.04.4 2.6-.48l3.52-5.6c.35-.53-.32-1.13-.82-.75l-3.79 2.87c-.25.2-.6.2-.86 0l-2.8-2.1a1.8 1.8 0 00-2.61.48z" />
    </svg>
  );
}
