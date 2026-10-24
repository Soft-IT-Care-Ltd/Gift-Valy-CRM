// PHOTO_PRINT.md PP-3 — a card message → the lines printed on the card.
// Pure and client-safe (Settings preview, the PP-4 card picker, the renderer).
//
// 1. Layout: a greeting at the start ("প্রিয় {to}," / "Dear {to},") and a short
//    signature at the end ("— {from}", "— তোমার {from}") get lines of their own;
//    explicit line breaks in the text are kept.
// 2. Names: {to} / {from} are replaced by the typed names. When a name is left
//    empty, its greeting/signature line is dropped (the owner's rule: "the name
//    lines are dropped cleanly"); a slot inside a sentence is removed and the
//    punctuation around it tidied ("Happy Birthday, {to}!" → "Happy Birthday!").

const SLOT_RE = /\{(to|from)\}/g;
// "প্রিয়" is matched in both encodings of য় (U+09DF, or য + nukta).
const GREETING_RE =
  /^((?:\u09AA\u09CD\u09B0\u09BF(?:\u09DF|\u09AF\u09BC)|Dear|Dearest|My dear)\s+[^,!\u0964\n]{1,30}?[,!])\s+(\S.*)$/u;
/** A signature: the text after the LAST " — ", when it carries a name slot or
 *  is a few words with no sentence punctuation ("— Rahim", "— তোমার মা"). */
function splitSignature(line: string): [string, string] | null {
  const i = line.lastIndexOf(" — ");
  if (i <= 0) return null;
  const tail = line.slice(i + 1).trim();
  const words = tail.replace(/^—\s*/, "").split(/\s+/).filter(Boolean);
  const hasSlot = /\{(to|from)\}/.test(tail);
  if (hasSlot || (words.length <= 3 && !/[.!?।]/.test(tail))) {
    return [line.slice(0, i).trim(), tail];
  }
  return null;
}

interface CardLine {
  text: string;
  /** A greeting or signature line — dropped whole when its name is empty. */
  nameLine: boolean;
}

function layoutLines(text: string): CardLine[] {
  const out: CardLine[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    const g = GREETING_RE.exec(line);
    if (g) {
      out.push({ text: g[1], nameLine: true });
      line = g[2];
    }
    const sig = splitSignature(line);
    if (sig) {
      if (sig[0]) out.push({ text: sig[0], nameLine: false });
      out.push({ text: sig[1], nameLine: true });
    } else {
      out.push({ text: line, nameLine: false });
    }
  }
  return out;
}

function tidy(s: string): string {
  return s
    .replace(/\s+([,!?।.])/g, "$1") // "Birthday ,"  → "Birthday,"
    .replace(/,\s*([!?।.])/g, "$1") // "Birthday,!"  → "Birthday!"
    .replace(/^[\s,!?।.]+/, "") // a slot that opened the sentence
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface CardNames {
  to?: string | null;
  from?: string | null;
}

/** The lines printed on the card, names filled in. */
export function cardLines(text: string, names: CardNames = {}): string[] {
  const values = {
    to: (names.to ?? "").trim(),
    from: (names.from ?? "").trim(),
  };
  const lines: string[] = [];
  let droppedGreeting = false;
  for (const line of layoutLines(text)) {
    const slots = [...line.text.matchAll(SLOT_RE)].map((m) => m[1] as "to" | "from");
    const missing = slots.some((s) => !values[s]);
    if (missing && line.nameLine) {
      droppedGreeting ||= lines.length === 0;
      continue;
    }
    const filled = line.text.replace(SLOT_RE, (_, s: "to" | "from") => values[s]);
    let out = missing ? tidy(filled) : filled.trim();
    // "Dear {to}, distance means…" without a name → "Distance means…"
    if (droppedGreeting && lines.length === 0) out = out.charAt(0).toUpperCase() + out.slice(1);
    if (out) lines.push(out);
  }
  return lines;
}

/** Longest custom message the SE may type (also the library's limit). */
export const CARD_TEXT_MAX = 500;
