import { prisma } from "@/lib/db";
import { requireGiftPrintPage } from "@/lib/gift-print-page";
import { getPrintSettings } from "@/lib/settings";
import { listPrintFonts } from "@/lib/file-storage";
import { fontDisplayName } from "@/lib/print-card";
import { serializeCardDesign } from "@/lib/card-library";
import { GiftPrintNav } from "@/components/settings/gift-print/gift-print-nav";
import { CardDesignsClient } from "@/components/settings/gift-print/card-designs-client";

export const dynamic = "force-dynamic";

// PHOTO_PRINT.md PP-3 — card designs: a text-free background per card size,
// the text area, colour, alignment and font (Admin + Manager).
export default async function CardDesignsPage() {
  const { canSizes, canLibrary } = await requireGiftPrintPage("library");
  const [designs, settings, fontNames, samples] = await Promise.all([
    prisma.cardDesign.findMany({ orderBy: [{ slot: "asc" }, { name: "asc" }] }),
    getPrintSettings(),
    listPrintFonts(),
    prisma.cardMessage.findMany({
      where: { isActive: true, hasNameSlots: true, language: "BN" },
      select: { text: true },
    }),
  ]);
  // Preview with the longest Bangla message — the worst case for fitting.
  const sample = samples.sort((a, b) => b.text.length - a.text.length)[0];
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <GiftPrintNav active="designs" canSizes={canSizes} canLibrary={canLibrary} />
      <CardDesignsClient
        designs={designs.map(serializeCardDesign)}
        sizes={{ CARD_1: settings.sizes.CARD_1, CARD_2: settings.sizes.CARD_2 }}
        fonts={fontNames.map((f) => ({ fontPath: f, name: fontDisplayName(f) }))}
        sampleText={sample?.text ?? "প্রিয় {to}, শুভ জন্মদিন! — {from}"}
      />
    </div>
  );
}
