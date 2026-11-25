import { requireGiftPrintPage } from "@/lib/gift-print-page";
import { getPrintSettings } from "@/lib/settings";
import { GiftPrintNav } from "@/components/settings/gift-print/gift-print-nav";
import { PrintSizesClient } from "@/components/settings/gift-print/print-sizes-client";

export const dynamic = "force-dynamic";

// PHOTO_PRINT.md PP-1 — print sizes (mm) and the A4 layout. Admin only.
export default async function GiftPrintSizesPage() {
  const { canSizes, canLibrary } = await requireGiftPrintPage("sizes");
  const settings = await getPrintSettings();
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <GiftPrintNav active="sizes" canSizes={canSizes} canLibrary={canLibrary} />
      <PrintSizesClient initial={settings} />
    </div>
  );
}
