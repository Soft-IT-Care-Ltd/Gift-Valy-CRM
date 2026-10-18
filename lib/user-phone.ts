// FUNNEL_LINER.md GV-5 — one form for a staff member's phone, used when it is
// saved (app/api/users/*), when someone signs in with it (lib/sign-in-user.ts)
// and by the migration that made users.phone unique. Client-safe (no Prisma).
//
//   Bangladesh mobile, any spelling: "+880 1712-345678", "8801712345678",
//   "008801712345678", "01712345678"            → "01712345678"
//   anything else with 8–15 digits ("+966 55 123 4567") → "+966551234567"
//   everything else                               → null (not a phone)
export function normalizeUserPhone(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  const bd = d.startsWith("880") ? d.slice(2) : d;
  if (/^01[3-9]\d{8}$/.test(bd)) return bd;
  if (d.startsWith("0")) return null; // a local number that is not a BD mobile
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
}
