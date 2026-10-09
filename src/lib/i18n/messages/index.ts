import { LOCALES, type Locale } from "../config";
import { common } from "./common";
import { auth } from "./auth";
import { dashboard } from "./dashboard";
import { chatRoom } from "./chatRoom";
import { chatMisc } from "./chatMisc";
import { ai } from "./ai";
import { translate } from "./translate";
import { schedule } from "./schedule";
import { settings } from "./settings";
import { system } from "./system";

const FILES = [common, auth, dashboard, chatRoom, chatMisc, ai, translate, schedule, settings, system];

/** Every key that exists (taken from German, which is the source of truth). */
export type MessageKey =
  | keyof typeof common.de
  | keyof typeof auth.de
  | keyof typeof dashboard.de
  | keyof typeof chatRoom.de
  | keyof typeof chatMisc.de
  | keyof typeof ai.de
  | keyof typeof translate.de
  | keyof typeof schedule.de
  | keyof typeof settings.de
  | keyof typeof system.de;

export const MESSAGES: Record<Locale, Record<string, string>> = Object.fromEntries(
  LOCALES.map((locale) => [locale, Object.assign({}, ...FILES.map((file) => file[locale]))])
) as Record<Locale, Record<string, string>>;
