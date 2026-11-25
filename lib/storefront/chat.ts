import { MESSAGE_PLACEHOLDERS, type MessagePlaceholder } from "./settings-shape";

// ROUND3 W-4 — "Order on WhatsApp" / "Order on Messenger". The message is
// built from the template in Settings → Website and opened in the app with a
// plain link. Client- and server-safe.

export type ChatChannel = "whatsapp" | "messenger";
export type MessageValues = Partial<Record<MessagePlaceholder, string | null>>;

const PLACEHOLDER = /\{([^{}\s]*)\}/g;

/** Every {…} in a template that isn't a known placeholder (W-7's form refuses them). */
export function unknownPlaceholders(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER)) {
    if (!(MESSAGE_PLACEHOLDERS as readonly string[]).includes(m[1])) out.add(`{${m[1]}}`);
  }
  return [...out];
}

/**
 * The template filled in. A line whose placeholder has nothing to say (no
 * choices on a plain product) is left out whole, so the message never reads
 * "Choices: ".
 */
export function fillTemplate(template: string, values: MessageValues): string {
  const kept: string[] = [];
  for (const line of template.replace(/\r\n?/g, "\n").split("\n")) {
    let empty = false;
    const filled = line.replace(PLACEHOLDER, (whole, key: string) => {
      if (!(MESSAGE_PLACEHOLDERS as readonly string[]).includes(key)) return whole;
      const v = values[key as MessagePlaceholder];
      if (v == null || v.trim() === "") {
        empty = true;
        return "";
      }
      return v;
    });
    if (!empty) kept.push(filled);
  }
  return kept.join("\n").trim();
}

export const whatsappLink = (number: string, message: string): string =>
  `https://wa.me/${number}${message ? `?text=${encodeURIComponent(message)}` : ""}`;

/** m.me doesn't always fill the text in — the button also copies it (components/storefront/chat-buttons). */
export const messengerLink = (page: string, message = ""): string =>
  `https://m.me/${encodeURIComponent(page)}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
