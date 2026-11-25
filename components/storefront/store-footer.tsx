import Link from "next/link";
import { cachedCategories, cachedSettings } from "@/lib/storefront/cached";
import { messengerLink, whatsappLink } from "@/lib/storefront/chat";
import { copy } from "@/lib/storefront/copy";
import { POLICY_KINDS, POLICY_TITLES } from "@/lib/storefront/settings-shape";

// ROUND3 W-4 — the navy footer: how to reach Gift Valy (Settings → Website;
// a line shows only when it is set), the categories and the policy pages
// that have text.
export async function StoreFooter() {
  const [s, categories] = await Promise.all([cachedSettings(), cachedCategories()]);
  const policies = POLICY_KINDS.filter((k) => s.policies[k]);
  const contact = [
    s.hotline ? { href: `tel:${s.hotline.replace(/[^\d+]/g, "")}`, label: copy.footer.hotline(s.hotline) } : null,
    s.whatsapp ? { href: whatsappLink(s.whatsapp, ""), label: copy.footer.whatsapp } : null,
    s.messengerPage ? { href: messengerLink(s.messengerPage), label: copy.footer.messenger } : null,
    s.facebookUrl ? { href: s.facebookUrl, label: copy.footer.facebook } : null,
  ].filter((x): x is { href: string; label: string } => x !== null);
  const linkClass = "flex min-h-12 items-center hover:text-orange-200 md:min-h-9";
  return (
    <footer className="mt-16 bg-navy text-white/85">
      <div className="sf-container grid gap-8 py-10 sm:grid-cols-3">
        <div className="flex flex-col gap-3">
          <p className="font-display text-2xl font-bold text-white">{copy.brand.name}</p>
          <p className="text-sm leading-relaxed">{copy.brand.tagline}</p>
          {s.officeAddress ? <p className="text-sm leading-relaxed whitespace-pre-line">{s.officeAddress}</p> : null}
        </div>
        {contact.length > 0 ? (
          <div className="flex flex-col text-[15px]">
            <p className="mb-1 font-semibold text-white">{copy.footer.contact}</p>
            {contact.map((c) => (
              <a key={c.label} href={c.href} className={linkClass} rel="noopener">
                {c.label}
              </a>
            ))}
          </div>
        ) : null}
        <div className="flex flex-col text-[15px]">
          <p className="mb-1 font-semibold text-white">{copy.footer.shop}</p>
          {categories.slice(0, 8).map((c) => (
            <Link key={c.slug} href={`/c/${c.slug}`} className={linkClass}>
              {c.name}
            </Link>
          ))}
          {policies.map((k) => (
            <Link key={k} href={`/policy/${k}`} className={linkClass}>
              {POLICY_TITLES[k]}
            </Link>
          ))}
        </div>
      </div>
      <div className="border-t border-white/15 px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] text-center text-xs text-white/70">
        {copy.footer.bottom(new Date().getFullYear())}
      </div>
    </footer>
  );
}
