/**
 * Tiny standalone dictionary for push notification texts (Deno edge
 * functions can't import from src/lib/i18n). Keep the locale codes in sync
 * with src/lib/i18n/config.ts.
 */

export type Locale = "de" | "en" | "fr" | "zh";

export const DEFAULT_LOCALE: Locale = "de";

export function normalizeLocale(value: unknown): Locale {
  return value === "de" || value === "en" || value === "fr" || value === "zh" ? value : DEFAULT_LOCALE;
}

const MESSAGES = {
  de: {
    someone: "Jemand",
    defaultPigeonName: "Deine Taube",
    aPigeon: "Eine Brieftaube",
    previewImage: "📷 Bild",
    previewVideo: "🎬 Video",
    previewVoice: "🎤 Sprachnachricht",
    previewNew: "Neue Nachricht",
    letterIncomingTitle: "🕊️ {pigeon} ist zu dir unterwegs",
    letterIncomingBody: "{sender} hat dir einen Brief geschickt. Verfolge den Flug im Chat!",
    incidentFallback: "Unterwegs ist etwas passiert.",
    incidentOtherPigeon: "Die Taube von {sender}",
    incidentTitle: "🕊️ {who}: Zwischenfall!",
    ownArrivedTitle: "🕊️ {pigeon} ist angekommen",
    ownArrivedBody: "Dein Brief wurde zugestellt.",
    letterArrivedTitle: "✉️ Brief von {sender} ist da!",
    testTitle: "🕊️ Test-Benachrichtigung",
    testBody: "Benachrichtigungen funktionieren auf diesem Gerät.",
  },
  en: {
    someone: "Someone",
    defaultPigeonName: "Your pigeon",
    aPigeon: "A carrier pigeon",
    previewImage: "📷 Photo",
    previewVideo: "🎬 Video",
    previewVoice: "🎤 Voice message",
    previewNew: "New message",
    letterIncomingTitle: "🕊️ {pigeon} is on its way to you",
    letterIncomingBody: "{sender} sent you a letter. Follow the flight in the chat!",
    incidentFallback: "Something happened along the way.",
    incidentOtherPigeon: "{sender}'s pigeon",
    incidentTitle: "🕊️ {who}: Incident!",
    ownArrivedTitle: "🕊️ {pigeon} has arrived",
    ownArrivedBody: "Your letter has been delivered.",
    letterArrivedTitle: "✉️ Letter from {sender} has arrived!",
    testTitle: "🕊️ Test notification",
    testBody: "Notifications are working on this device.",
  },
  fr: {
    someone: "Quelqu'un",
    defaultPigeonName: "Ton pigeon",
    aPigeon: "Un pigeon voyageur",
    previewImage: "📷 Photo",
    previewVideo: "🎬 Vidéo",
    previewVoice: "🎤 Message vocal",
    previewNew: "Nouveau message",
    letterIncomingTitle: "🕊️ {pigeon} est en route vers toi",
    letterIncomingBody: "{sender} t'a envoyé une lettre. Suis le vol dans le chat !",
    incidentFallback: "Il s'est passé quelque chose en chemin.",
    incidentOtherPigeon: "Le pigeon de {sender}",
    incidentTitle: "🕊️ {who} : incident !",
    ownArrivedTitle: "🕊️ {pigeon} est arrivé",
    ownArrivedBody: "Ta lettre a été livrée.",
    letterArrivedTitle: "✉️ La lettre de {sender} est arrivée !",
    testTitle: "🕊️ Notification de test",
    testBody: "Les notifications fonctionnent sur cet appareil.",
  },
  zh: {
    someone: "有人",
    defaultPigeonName: "你的信鸽",
    aPigeon: "一只信鸽",
    previewImage: "📷 图片",
    previewVideo: "🎬 视频",
    previewVoice: "🎤 语音消息",
    previewNew: "新消息",
    letterIncomingTitle: "🕊️ {pigeon}正飞向你",
    letterIncomingBody: "{sender}给你寄了一封信。快去聊天里追踪飞行吧！",
    incidentFallback: "途中发生了一些状况。",
    incidentOtherPigeon: "{sender}的信鸽",
    incidentTitle: "🕊️ {who}：出状况了！",
    ownArrivedTitle: "🕊️ {pigeon}已抵达",
    ownArrivedBody: "你的信已送达。",
    letterArrivedTitle: "✉️ {sender}的信到了！",
    testTitle: "🕊️ 测试通知",
    testBody: "此设备上的通知运行正常。",
  },
} as const;

export type PushMessageKey = keyof (typeof MESSAGES)["de"];

/** Translates a push text key into the given locale, filling {placeholders}. */
export function pushT(
  locale: Locale,
  key: PushMessageKey,
  params?: Record<string, string>
): string {
  const template: string = MESSAGES[locale]?.[key] ?? MESSAGES[DEFAULT_LOCALE][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
}
