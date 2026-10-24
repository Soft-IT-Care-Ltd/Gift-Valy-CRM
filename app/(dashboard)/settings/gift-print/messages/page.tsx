import { prisma } from "@/lib/db";
import { requireGiftPrintPage } from "@/lib/gift-print-page";
import { serializeCardMessage } from "@/lib/card-library";
import { GiftPrintNav } from "@/components/settings/gift-print/gift-print-nav";
import { CardMessagesClient } from "@/components/settings/gift-print/card-messages-client";

export const dynamic = "force-dynamic";

// PHOTO_PRINT.md PP-3 — the card message library (Admin + Manager).
export default async function CardMessagesPage() {
  const { canSizes, canLibrary } = await requireGiftPrintPage("library");
  const messages = await prisma.cardMessage.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <GiftPrintNav active="messages" canSizes={canSizes} canLibrary={canLibrary} />
      <CardMessagesClient messages={messages.map(serializeCardMessage)} />
    </div>
  );
}
