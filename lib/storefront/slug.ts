// ROUND3 W-2 — website addresses (/p/<slug>, /c/<slug>). Taken from the
// Antu Boutique reference (C9) unchanged in behaviour. Product names are often
// Bangla; an address must be Latin so it survives being pasted into
// Messenger, typed, and read by search engines. Bangla is transliterated the
// way shoppers spell it in English (জামদানি → jamdani, শাড়ি → shari,
// থ্রি-পিস → thri-pis); when nothing usable is left the SKU / package
// code is used instead. Pure and client-safe — the product form previews it.

const CONSONANTS: Record<string, string> = {
  "ক": "k", "খ": "kh", "গ": "g", "ঘ": "gh", "ঙ": "ng",
  "চ": "ch", "ছ": "chh", "জ": "j", "ঝ": "jh", "ঞ": "n",
  "ট": "t", "ঠ": "th", "ড": "d", "ঢ": "dh", "ণ": "n",
  "ত": "t", "থ": "th", "দ": "d", "ধ": "dh", "ন": "n",
  "প": "p", "ফ": "f", "ব": "b", "ভ": "bh", "ম": "m",
  "য": "j", "র": "r", "ল": "l", "শ": "sh", "ষ": "sh", "স": "s", "হ": "h",
  "ড়": "r", "ঢ়": "rh", "য়": "y", "ৎ": "t",
};
// The decomposed spellings of ড় ঢ় য় (NFC keeps them decomposed).
const NUKTA = "়";
const NUKTA_FORMS: Record<string, string> = { "ড": "r", "ঢ": "rh", "য": "y" };

const VOWELS: Record<string, string> = {
  "অ": "o", "আ": "a", "ই": "i", "ঈ": "i", "উ": "u", "ঊ": "u", "ঋ": "ri",
  "এ": "e", "ঐ": "oi", "ও": "o", "ঔ": "ou",
};
const VOWEL_SIGNS: Record<string, string> = {
  "া": "a", "ি": "i", "ী": "i", "ু": "u", "ূ": "u", "ৃ": "ri",
  "ে": "e", "ৈ": "oi", "ো": "o", "ৌ": "ou",
};
const HASANTA = "্";
const MARKS: Record<string, string> = { "ং": "ng", "ঃ": "h", "ঁ": "" };
const DIGITS = "০১২৩৪৫৬৭৮৯";

const isConsonantAt = (chars: string[], i: number) => chars[i] !== undefined && (CONSONANTS[chars[i]] !== undefined || NUKTA_FORMS[chars[i]] !== undefined);

/** Bangla → Latin, the way it's commonly typed. Latin text passes through. */
export function transliterate(input: string): string {
  const chars = [...input.normalize("NFC")];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const start = i;
    let consonant: string | undefined;
    if (NUKTA_FORMS[c] !== undefined && chars[i + 1] === NUKTA) {
      consonant = NUKTA_FORMS[c];
      i++;
    } else if (CONSONANTS[c] !== undefined) {
      consonant = CONSONANTS[c];
    }
    if (consonant !== undefined) {
      out += consonant;
      // The inherent vowel is sounded at the start of a word before another
      // consonant (কলম → kolm, নকশী → nokshi); elsewhere it is mostly silent
      // in how shoppers spell names (জামদানি → jamdani, কাতান → katan).
      const next = chars[i + 1];
      const wordStart = start === 0 || !/[ঀ-৿]/.test(chars[start - 1]);
      if (wordStart && isConsonantAt(chars, i + 1) && next !== HASANTA) out += "o";
      continue;
    }
    if (VOWELS[c] !== undefined) out += VOWELS[c];
    else if (VOWEL_SIGNS[c] !== undefined) out += VOWEL_SIGNS[c];
    else if (MARKS[c] !== undefined) out += MARKS[c];
    else if (c === HASANTA || c === NUKTA) continue;
    else if (DIGITS.includes(c)) out += String(DIGITS.indexOf(c));
    else out += c;
  }
  return out;
}

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 60;

/** Any text → a slug: transliterated, lower case, words joined by single hyphens, at most 60 characters (cut at a word). */
export function slugify(input: string): string {
  const latin = transliterate(input)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (latin.length <= MAX_SLUG_LENGTH) return latin;
  const cut = latin.slice(0, MAX_SLUG_LENGTH + 1);
  const lastHyphen = cut.lastIndexOf("-");
  return (lastHyphen > 10 ? cut.slice(0, lastHyphen) : latin.slice(0, MAX_SLUG_LENGTH)).replace(/-+$/, "");
}

/** A product's first-choice slug: its name, or its code when the name gives nothing usable. */
export function productSlugBase(name: string, code: string): string {
  const fromName = slugify(name);
  return fromName.length >= 2 ? fromName : slugify(code) || "item";
}

/**
 * Candidates to try in turn until one is free: the base, the base with the
 * product code, then numbered. `taken` says whether a slug is already used
 * (by another product, a category, or an old address kept as a redirect).
 */
export async function firstFreeSlug(base: string, code: string | null, taken: (slug: string) => Promise<boolean>): Promise<string> {
  const candidates = [base];
  const codePart = code ? slugify(code) : "";
  if (codePart && !base.endsWith(`-${codePart}`) && base !== codePart) candidates.push(`${base}-${codePart}`);
  for (const slug of candidates) if (!(await taken(slug))) return slug;
  const stem = candidates[candidates.length - 1];
  for (let n = 2; n < 1000; n++) {
    const slug = `${stem}-${n}`;
    if (!(await taken(slug))) return slug;
  }
  throw new Error("No free website address");
}
