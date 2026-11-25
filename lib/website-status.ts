import { prisma } from "@/lib/db";
import { normalizeWebSettings, WEBSITE_SETTINGS_KEY } from "@/lib/storefront/settings-shape";
import type { WebsiteStatus } from "@/lib/storefront/coming-soon";

// ROUND3 W-7 — Settings → Website → "Website on". The proxy asks on every
// website request (lib/storefront/front-door.ts), so the answer is cached for
// a few seconds. The proxy and the route handlers run in the same server
// process but are bundled separately: a plain module variable would be two
// copies and a save would clear only the Settings route's. The copy lives on
// globalThis instead, and every Settings → Website save clears it, so the
// very next page load already sees the change; CACHE_MS is only the safety
// net for a change made some other way. If the database can't be read the
// last known answer stands (on, when there is none) — a database hiccup never
// takes the website down.

const CACHE_MS = 5_000;
type Slot = { cached: { value: WebsiteStatus; at: number } | null };
const SLOT = Symbol.for("giftvaly.storefront.websiteStatus");
const slot = ((globalThis as unknown as Record<symbol, Slot>)[SLOT] ??= { cached: null });

const ON: WebsiteStatus = { on: true, contact: { whatsapp: "", messengerPage: "", facebookUrl: "", hotline: "" } };

export async function getWebsiteStatus(now = Date.now()): Promise<WebsiteStatus> {
  if (slot.cached && now - slot.cached.at < CACHE_MS) return slot.cached.value;
  try {
    const row = await prisma.setting.findUnique({ where: { key: WEBSITE_SETTINGS_KEY }, select: { value: true } });
    const s = normalizeWebSettings(row?.value ?? null);
    slot.cached = {
      value: { on: s.websiteOn, contact: { whatsapp: s.whatsapp, messengerPage: s.messengerPage, facebookUrl: s.facebookUrl, hotline: s.hotline } },
      at: now,
    };
  } catch (e) {
    console.error("Website settings unreadable — keeping the last known Website on/off:", e);
    slot.cached = { value: slot.cached?.value ?? ON, at: now };
  }
  return slot.cached.value;
}

/** Called by every Settings → Website save. */
export function forgetWebsiteStatus(): void {
  slot.cached = null;
}
