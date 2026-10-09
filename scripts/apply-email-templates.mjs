#!/usr/bin/env node
/**
 * Pushes supabase/templates/{invite,magic_link,recovery}.html and the email
 * subjects to the hosted Supabase project via the Management API.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/apply-email-templates.mjs
 *   (add --dry-run to only print what would be sent)
 *
 * Subjects: the HTML bodies switch language with Go-template conditionals on
 * user_metadata.language, but it is not guaranteed that GoTrue renders the
 * *subject* through the same template engine with user data. So by default
 * this sets a neutral, language-independent subject ("Encrypted Pigeon 🕊️")
 * that is safe in all four languages. Once you have verified that your
 * GoTrue version renders subject templates with .Data, run with
 * --localized-subjects to use {{ if eq .Data.language "en" }}… conditionals
 * (German = fallback) instead.
 *
 * No dependencies (Node 18+ for global fetch).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PROJECT_REF = "jtxruiahjdgeuugapdsb";
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;
const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "templates");

const NEUTRAL_SUBJECT = "Encrypted Pigeon 🕊️";

// Same wording as the header comments of the template files.
const SUBJECTS = {
  invite: {
    de: "Du bist zu Encrypted Pigeon eingeladen",
    en: "You're invited to Encrypted Pigeon",
    fr: "Tu es invité(e) sur Encrypted Pigeon",
    zh: "你被邀请加入 Encrypted Pigeon",
  },
  magic_link: {
    de: "Dein Anmeldelink für Encrypted Pigeon",
    en: "Your sign-in link for Encrypted Pigeon",
    fr: "Ton lien de connexion pour Encrypted Pigeon",
    zh: "你的 Encrypted Pigeon 登录链接",
  },
  recovery: {
    de: "Dein neuer Anmeldelink für Encrypted Pigeon",
    en: "Your new sign-in link for Encrypted Pigeon",
    fr: "Ton nouveau lien de connexion pour Encrypted Pigeon",
    zh: "你的 Encrypted Pigeon 新登录链接",
  },
};

function localizedSubject(s) {
  return (
    '{{ $lang := "" }}{{ with .Data.language }}{{ $lang = . }}{{ end }}' +
    `{{ if eq $lang "en" }}${s.en}{{ else if eq $lang "fr" }}${s.fr}{{ else if eq $lang "zh" }}${s.zh}{{ else }}${s.de}{{ end }}`
  );
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
const dryRun = process.argv.includes("--dry-run");
const localized = process.argv.includes("--localized-subjects");

if (!token && !dryRun) {
  console.error("Set SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens).");
  process.exit(1);
}

const body = {};
for (const name of Object.keys(SUBJECTS)) {
  body[`mailer_templates_${name}_content`] = await readFile(path.join(TEMPLATE_DIR, `${name}.html`), "utf8");
  body[`mailer_subjects_${name}`] = localized ? localizedSubject(SUBJECTS[name]) : NEUTRAL_SUBJECT;
}

if (dryRun) {
  console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}

const response = await fetch(API_URL, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

if (!response.ok) {
  console.error(`Failed: ${response.status} ${response.statusText}\n${await response.text()}`);
  process.exit(1);
}
console.log(`Email templates and subjects updated (${localized ? "localized" : "neutral"} subjects).`);
