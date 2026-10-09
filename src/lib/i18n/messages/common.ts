import { defineMessages } from "../define";

// Keys in this file start with "common." (see ../define.ts). Strings that
// several areas share (buttons, generic errors) live here.
export const common = defineMessages({
  de: {
    "common.networkError": "Verbindung zum Server fehlgeschlagen. Bitte Internet/VPN prüfen und nochmal versuchen.",
    "common.appDescription": "Verschlüsselte Nachrichten, zugestellt per Taubenpost.",
    "common.language": "Sprache",
    "common.languageHint": "Gilt für die ganze App, Benachrichtigungen und E-Mails an dich.",
    "common.languageSaveFailed": "Sprache konnte nicht gespeichert werden.",
  },
  en: {
    "common.networkError": "Connection to the server failed. Please check your internet/VPN and try again.",
    "common.appDescription": "Encrypted messages, delivered by carrier pigeon.",
    "common.language": "Language",
    "common.languageHint": "Applies to the whole app, notifications and emails to you.",
    "common.languageSaveFailed": "Couldn't save the language.",
  },
  fr: {
    "common.networkError": "Connexion au serveur impossible. Vérifie ta connexion internet/VPN et réessaie.",
    "common.appDescription": "Messages chiffrés, livrés par pigeon voyageur.",
    "common.language": "Langue",
    "common.languageHint": "S'applique à toute l'application, aux notifications et aux e-mails que tu reçois.",
    "common.languageSaveFailed": "Impossible d'enregistrer la langue.",
  },
  zh: {
    "common.networkError": "连接服务器失败。请检查网络/VPN后重试。",
    "common.appDescription": "加密消息，由信鸽送达。",
    "common.language": "语言",
    "common.languageHint": "适用于整个应用、通知以及发送给你的邮件。",
    "common.languageSaveFailed": "无法保存语言设置。",
  },
});
