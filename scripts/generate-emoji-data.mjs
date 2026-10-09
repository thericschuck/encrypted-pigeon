/**
 * Builds src/lib/emoji/emoji-data.<locale>.json for the chat's emoji picker from
 * Emojibase (MIT, https://emojibase.dev) — names and search terms in every UI
 * language (one file per language: emoji-data.<locale>.json).
 *
 *     node scripts/generate-emoji-data.mjs      # Node 18+ (global fetch)
 *
 * Checked into the repo instead of loaded from a CDN at runtime: the
 * picker then works offline and wherever the CDN isn't reachable (China).
 *
 * - Emoji versions above MAX_EMOJI_VERSION are left out: phones that are a
 *   couple of years old show them as empty boxes.
 * - No skin-tone variants and no "component" group (bare skin tones, hair).
 * - Search text = localized label + tags, lower-cased, one string per emoji.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EMOJIBASE_VERSION = "17.0.0";
// 15.0: iOS 16.4+, Android 14+.
const MAX_EMOJI_VERSION = 15.0;
const LOCALES = ["de", "en", "fr", "zh"];
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "emoji");

// Tab icon per group (Emojibase group order).
const GROUP_ICONS = {
  "smileys-emotion": "😀",
  "people-body": "👋",
  "animals-nature": "🐻",
  "food-drink": "🍔",
  "travel-places": "🚗",
  activities: "⚽",
  objects: "💡",
  symbols: "❤️",
  flags: "🏳️",
};

// EMOJIBASE_DIR=<path to an installed emojibase-data> reads from disk instead of the CDN.
async function load(locale, file) {
  if (process.env.EMOJIBASE_DIR) {
    return JSON.parse(await readFile(join(process.env.EMOJIBASE_DIR, locale, file), "utf8"));
  }
  const response = await fetch(`https://cdn.jsdelivr.net/npm/emojibase-data@${EMOJIBASE_VERSION}/${locale}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.json();
}

for (const locale of LOCALES) {
  const [compact, full, messages] = await Promise.all([
    load(locale, "compact.json"),
    load(locale, "data.json"),
    load(locale, "messages.json"),
  ]);

  const versionByHex = new Map(full.map((e) => [e.hexcode, e.version]));

  const groups = messages.groups
    .filter((g) => GROUP_ICONS[g.key])
    .sort((a, b) => a.order - b.order)
    .map((g) => ({
      key: g.key,
      label: g.message,
      icon: GROUP_ICONS[g.key],
      emojis: compact
        .filter((e) => e.group === g.order && (versionByHex.get(e.hexcode) ?? 99) <= MAX_EMOJI_VERSION)
        .sort((a, b) => a.order - b.order)
        .map((e) => [e.unicode, [e.label, ...(e.tags ?? [])].join(" ").toLowerCase()]),
    }));

  const out = join(OUT_DIR, `emoji-data.${locale}.json`);
  await writeFile(out, JSON.stringify({ groups }) + "\n");
  const total = groups.reduce((n, g) => n + g.emojis.length, 0);
  console.log(`Wrote ${total} emojis in ${groups.length} groups to ${out}`);
}
