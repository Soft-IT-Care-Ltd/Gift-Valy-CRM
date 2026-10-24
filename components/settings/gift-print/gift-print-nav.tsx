import Link from "next/link";

// PHOTO_PRINT.md — the Settings → Gift print sub-pages. Sizes & layout are
// Admin-only (settings.manage); designs and messages need print.settings.
export function GiftPrintNav({
  active,
  canSizes,
  canLibrary,
}: {
  active: "sizes" | "designs" | "messages";
  canSizes: boolean;
  canLibrary: boolean;
}) {
  const tabs = [
    canSizes && { key: "sizes", href: "/settings/gift-print", label: "Sizes & layout" },
    canLibrary && { key: "designs", href: "/settings/gift-print/designs", label: "Card designs" },
    canLibrary && { key: "messages", href: "/settings/gift-print/messages", label: "Card messages" },
  ].filter(Boolean) as { key: string; href: string; label: string }[];
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-semibold">Gift print</h1>
        <p className="text-sm text-muted-foreground">
          Customize Chocolate Box photos and wishing cards — printed by Packing on A4 photo paper.
        </p>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              active === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
