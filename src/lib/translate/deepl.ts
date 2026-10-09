import { getT } from "@/lib/i18n/server";
import type { TFunction } from "@/lib/i18n/translate";
import type { SourceLanguage, TargetLanguage } from "@/lib/translate/languages";

/**
 * DeepL API client — server only: DEEPL_API_KEY has no NEXT_PUBLIC_ prefix
 * and must never reach the browser. The browser only ever talks to our own
 * server action, which talks to DeepL.
 */

export class DeepLError extends Error {}

function apiKey(t: TFunction): string {
  const key = process.env.DEEPL_API_KEY;
  if (!key) throw new DeepLError(t("translate.error.notConfigured"));
  return key;
}

// Free-tier keys end in ":fx" and live on a separate host.
function apiBase(key: string): string {
  return key.endsWith(":fx") ? "https://api-free.deepl.com/v2" : "https://api.deepl.com/v2";
}

function errorForStatus(status: number, t: TFunction): string {
  switch (status) {
    case 403:
      return t("translate.error.keyRejected");
    case 429:
      return t("translate.error.rateLimited");
    case 456:
      return t("translate.error.quotaExceeded");
    default:
      return status >= 500
        ? t("translate.error.unavailable")
        : t("translate.error.failedStatus", { status });
  }
}

async function deeplFetch(path: string, init?: RequestInit): Promise<Response> {
  const t = await getT();
  const key = apiKey(t);
  let response: Response;
  try {
    response = await fetch(`${apiBase(key)}${path}`, {
      ...init,
      headers: {
        Authorization: `DeepL-Auth-Key ${key}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new DeepLError(t("translate.error.unavailable"));
  }
  if (!response.ok) throw new DeepLError(errorForStatus(response.status, t));
  return response;
}

export interface Translation {
  text: string;
  /** What DeepL detected (or was told) the source language is, e.g. "DE". */
  detectedSource: string;
}

export async function translate(
  text: string,
  source: SourceLanguage,
  target: TargetLanguage
): Promise<Translation> {
  const response = await deeplFetch("/translate", {
    method: "POST",
    body: JSON.stringify({
      text: [text],
      target_lang: target,
      ...(source === "auto" ? {} : { source_lang: source }),
    }),
  });
  const data = (await response.json()) as {
    translations: { text: string; detected_source_language: string }[];
  };
  const first = data.translations[0];
  return { text: first?.text ?? "", detectedSource: first?.detected_source_language ?? "" };
}

export interface Usage {
  used: number;
  limit: number;
}

/** Characters used this billing period. Null if it can't be read right now. */
export async function usage(): Promise<Usage | null> {
  try {
    const response = await deeplFetch("/usage");
    const data = (await response.json()) as { character_count: number; character_limit: number };
    return { used: data.character_count, limit: data.character_limit };
  } catch {
    return null;
  }
}
