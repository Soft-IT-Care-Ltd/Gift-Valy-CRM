import type { Prisma, PrismaClient } from "@prisma/client";
import { dbDate, normalizePhone } from "./order-constants";

type Tx = Prisma.TransactionClient | PrismaClient;

// CORRECTIONS Orders §7 (form part) — persist the recipient's Birthday /
// Anniversary against the customer↔recipient profile (keyed by the recipient's
// BD phone), not just the order. Blank dates never clobber values that were
// saved earlier: the SE may skip them on a repeat order without wiping the
// profile. A row is only created when at least one date is provided; the
// name/relation refresh whenever a row already exists.
export async function upsertRecipientOccasions(
  db: Tx,
  input: {
    customerId: number;
    recipientName: string;
    recipientPhoneBd: string;
    relation: string | null;
    birthday: string | null | undefined; // YYYY-MM-DD
    anniversary: string | null | undefined; // YYYY-MM-DD
    userId: number;
  }
): Promise<void> {
  const phone = normalizePhone(input.recipientPhoneBd);
  if (!phone) return;

  const dates = {
    ...(input.birthday ? { birthday: dbDate(input.birthday) } : {}),
    ...(input.anniversary ? { anniversary: dbDate(input.anniversary) } : {}),
  };

  const existing = await db.customerOccasion.findUnique({
    where: {
      customerId_recipientPhoneBd: {
        customerId: input.customerId,
        recipientPhoneBd: phone,
      },
    },
    select: { id: true },
  });

  if (existing) {
    await db.customerOccasion.update({
      where: { id: existing.id },
      data: {
        recipientName: input.recipientName,
        relation: input.relation,
        ...dates,
        updatedBy: input.userId,
      },
    });
  } else if (input.birthday || input.anniversary) {
    await db.customerOccasion.create({
      data: {
        customerId: input.customerId,
        recipientName: input.recipientName,
        recipientPhoneBd: phone,
        relation: input.relation,
        ...dates,
        createdBy: input.userId,
        updatedBy: input.userId,
      },
    });
  }
}

// Profile lookup for form prefill (edit page) — returns YYYY-MM-DD strings.
export async function findRecipientOccasions(
  db: Tx,
  customerId: number,
  recipientPhoneBd: string
): Promise<{ birthday: string | null; anniversary: string | null }> {
  const phone = normalizePhone(recipientPhoneBd);
  const row = phone
    ? await db.customerOccasion.findUnique({
        where: {
          customerId_recipientPhoneBd: {
            customerId,
            recipientPhoneBd: phone,
          },
        },
        select: { birthday: true, anniversary: true },
      })
    : null;
  return {
    birthday: row?.birthday ? row.birthday.toISOString().slice(0, 10) : null,
    anniversary: row?.anniversary
      ? row.anniversary.toISOString().slice(0, 10)
      : null,
  };
}
