import { INTL_LOCALES, type Locale } from "./config";

export type MessageParams = Record<string, string | number>;

/**
 * t("chatRoom.unread", { count: 3 }): looks the key up, replaces {placeholders}.
 * Plurals: if params.count is given and "<key>_one" / "<key>_other" exist,
 * the one matching the locale's plural rules is used (Chinese only has
 * "other"). An unknown key is returned as-is (and warned about in dev).
 */
export type TFunction = (key: string, params?: MessageParams) => string;

export function createT(locale: Locale, messages: Record<string, string>): TFunction {
  const plural = new Intl.PluralRules(INTL_LOCALES[locale]);
  return (key, params) => {
    let template: string | undefined;
    if (params && typeof params.count === "number") {
      template = messages[`${key}_${plural.select(params.count)}`] ?? messages[`${key}_other`];
    }
    template ??= messages[key];
    if (template === undefined) {
      if (process.env.NODE_ENV !== "production") console.warn(`[i18n] missing message: ${key}`);
      return key;
    }
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match
    );
  };
}
