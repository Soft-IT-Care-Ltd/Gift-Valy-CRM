import type { Prisma } from "@prisma/client";
import { normalizeUserPhone, userPhoneSpellings } from "./user-phone";

// FUNNEL_LINER.md GV-5 — who can sign in with this phone number or email: an
// active user whose email (any case) or phone (any spelling of the same
// number — lib/user-phone.ts) equals what was typed. lib/auth.ts (the real sign-in) and /api/platform/has-user ("is this
// number yours?") both use this one match, so they can never disagree.
// null = the identifier can match nobody (not an email, not a phone).
export function signInUserWhere(identifier: string): Prisma.UserWhereInput | null {
  const id = identifier.trim();
  if (!id) return null;
  if (id.includes("@")) {
    return { isActive: true, email: { equals: id.toLowerCase(), mode: "insensitive" } };
  }
  const phone = normalizeUserPhone(id);
  return phone ? { isActive: true, phone: { in: userPhoneSpellings(phone) } } : null;
}
