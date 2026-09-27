/**
 * Builds src/lib/emoji/emoji-data.json for the chat's emoji picker from
 * Emojibase (MIT, https://emojibase.dev) — German names and search terms.
 *
 *     node scripts/generate-emoji-data.mjs      # Node 18+ (global fetch)
 *
 * Checked into the repo instead of loaded from a CDN at runtime: the
 * picker then works offline and wherever the CDN isn't reachable (China).
 *
 * - Emoji versions above MAX_EMOJI_VERSION are left out: phones that are a
 *   couple of years old show them as empty boxes.
 * - No skin-tone variants and no "component" group (bare skin tones, hair).
 * - Search text = German label + tags, lower-cased, one string per emoji.
 */

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EMOJIBASE_VERSION = "17.0.0";
// 15.0: iOS 16.4+, Android 14+.
const MAX_EMOJI_VERSION = 15.0;
const BASE = `https://cdn.jsdelivr.net/npm/emojibase-data@${EMOJIBASE_VERSION}/de`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "emoji", "emoji-data.json");

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

async function load(file) {
  const response = await fetch(`${BASE}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.json();
}

const [compact, full, messages] = await Promise.all([
  load("compact.json"),
  load("data.json"),
  load("messages.json"),
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

await writeFile(OUT, JSON.stringify({ groups }) + "\n");
const total = groups.reduce((n, g) => n + g.emojis.length, 0);
console.log(`Wrote ${total} emojis in ${groups.length} groups to ${OUT}`);
