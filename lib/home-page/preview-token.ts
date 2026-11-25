import { createHmac, timingSafeEqual } from "node:crypto";

// ROUND3 W-7 — the home page preview is the real website (its own fonts,
// theme and pages) showing the DRAFT. The website never reads the staff
// session, so the ERP hands out a signed link instead:
// /preview/home?t=<expiry>.<signature>, good for two hours. Without a valid
// signature the preview is a plain 404.

export const PREVIEW_TTL_MS = 2 * 3_600_000;

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set");
  return s;
}

const sign = (exp: number) => createHmac("sha256", secret()).update(`giftvaly-home-preview:${exp}`).digest("base64url");

export function makePreviewToken(now: number = Date.now()): string {
  const exp = now + PREVIEW_TTL_MS;
  return `${exp}.${sign(exp)}`;
}

export function verifyPreviewToken(token: string | null | undefined, now: number = Date.now()): boolean {
  if (!token || token.length > 200) return false;
  const [expText, sig] = token.split(".");
  const exp = Number(expText);
  if (!Number.isSafeInteger(exp) || exp < now || exp > now + PREVIEW_TTL_MS || !sig) return false;
  const want = Buffer.from(sign(exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
