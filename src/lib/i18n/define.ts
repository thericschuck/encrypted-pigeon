import type { Locale } from "./config";

/**
 * One file per area under ./messages. German is the source of truth; the
 * other languages must have exactly the same keys (the compiler checks it).
 * Keys are flat strings and MUST start with the file's own prefix
 * ("chatRoom.sendButton") — the keys of all files are merged into one
 * dictionary. Placeholders: {name}. Plurals: "<key>_one" / "<key>_other"
 * plus { count } (Chinese: only "<key>_other").
 */
export function defineMessages<const D extends Record<string, string>>(
  messages: { de: D } & Record<Exclude<Locale, "de">, Record<keyof D, string>>
) {
  return messages;
}
