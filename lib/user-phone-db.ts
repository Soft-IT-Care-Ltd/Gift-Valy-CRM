import { NextResponse } from "next/server";
import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeUserPhone, userPhoneSpellings } from "./user-phone";

// FUNNEL_LINER.md GV-5 — a staff phone is a sign-in identifier, so it is
// stored normalised and is unique among users (users_phone_key). The user
// routes call this before writing so a duplicate is refused with a clear
// message, not a bare unique-constraint error.
//
// raw undefined → leave as is; "" / null → clear; otherwise normalise.
// Returns the value to write, or the 400/409 response to send.
export async function checkUserPhone(
  db: PrismaClient | Prisma.TransactionClient,
  raw: string | null | undefined,
  userId?: number
): Promise<{ phone: string | null | undefined } | { error: NextResponse }> {
  if (raw === undefined) return { phone: undefined };
  if (raw === null || raw.trim() === "") return { phone: null };
  const phone = normalizeUserPhone(raw);
  if (!phone) {
    return {
      error: NextResponse.json(
        { error: "Enter a valid phone number (e.g. 017XXXXXXXX)" },
        { status: 400 }
      ),
    };
  }
  const holder = await db.user.findFirst({
    where: { phone: { in: userPhoneSpellings(phone) }, ...(userId ? { id: { not: userId } } : {}) },
    select: { name: true },
  });
  if (holder) {
    return {
      error: NextResponse.json(
        { error: `This phone number is already used by ${holder.name}` },
        { status: 409 }
      ),
    };
  }
  return { phone };
}
