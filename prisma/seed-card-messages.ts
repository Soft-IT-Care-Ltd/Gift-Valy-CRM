// PHOTO_PRINT.md PP-3 — `npm run db:seed-card-messages`: adds the starter card
// messages (lib/card-message-seed.ts). Safe on production and staging — it
// writes card_messages only (never orders, never order_sequences; CLAUDE.md
// rule 6) and only ADDS: a message whose text already exists is skipped, so an
// Admin's edits and deactivations survive and a second run adds nothing.
import { PrismaClient } from "@prisma/client";
import { SEED_CARD_MESSAGES } from "../lib/card-message-seed";
import { hasNameSlots } from "../lib/print-constants";

const prisma = new PrismaClient();

async function main() {
  const { count } = await prisma.cardMessage.createMany({
    data: SEED_CARD_MESSAGES.map((m, i) => ({
      occasion: m.occasion,
      language: m.language,
      text: m.text,
      hasNameSlots: hasNameSlots(m.text),
      sortOrder: (i + 1) * 10,
    })),
    skipDuplicates: true, // card_messages.text is unique
  });
  const skipped = SEED_CARD_MESSAGES.length - count;
  console.log(
    `Card messages: ${count} added, ${skipped} already there (${SEED_CARD_MESSAGES.length} in the seed).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
