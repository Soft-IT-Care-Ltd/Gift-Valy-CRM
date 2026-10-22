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

// Every way the same number may already be stored. The user routes and the GV-5
// migration store the normalised form, but a row written another way (the
// seed, a bootstrap script, a hand fix in psql) must still sign in — so a
// lookup matches all of them: "01712345678" → itself, "+8801…", "8801…",
// "008801…"; "+966…" → itself, "966…", "00966…".
export function userPhoneSpellings(normalized: string): string[] {
  const intl = normalized.startsWith("+") ? normalized.slice(1) : `88${normalized}`;
  return [...new Set([normalized, `+${intl}`, intl, `00${intl}`])];
}
