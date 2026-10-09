import type { Database } from "@/lib/supabase/types";
import type { TFunction } from "@/lib/i18n/translate";

export type ProfileRow = Database["pigeon"]["Tables"]["profiles"]["Row"];

/** The profile fields the UI needs to render a person anywhere. */
export type MemberProfile = Pick<
  ProfileRow,
  "id" | "email" | "display_name" | "avatar_url" | "pigeon_name" | "accent_color" | "theme" | "language" | "timezone" | "schedule_public"
>;

export const MEMBER_PROFILE_COLUMNS =
  "id, email, display_name, avatar_url, pigeon_name, accent_color, theme, language, timezone, schedule_public";

export const AVATAR_BUCKET = "pigeon-avatars";

export const DEFAULT_ACCENT = "#171717";
export const DEFAULT_PIGEON_NAME = "Brieftaube";

// Every preset keeps white text readable (≥ 4.5:1) and works on both the
// light and the dark background, so no per-theme variants are needed.
// `labelKey` is a message key (translate with t(preset.labelKey)); `label` is
// the German fallback.
export const ACCENT_PRESETS: { value: string; label: string; labelKey: string }[] = [
  { value: "#171717", label: "Tinte", labelKey: "settings.accent.ink" },
  { value: "#b0532b", label: "Terrakotta", labelKey: "settings.accent.terracotta" },
  { value: "#3f6b3a", label: "Olive", labelKey: "settings.accent.olive" },
  { value: "#1f5f8b", label: "Nachtblau", labelKey: "settings.accent.navy" },
  { value: "#6b3fa0", label: "Pflaume", labelKey: "settings.accent.plum" },
  { value: "#a3324f", label: "Weinrot", labelKey: "settings.accent.wine" },
];

export function displayNameOf(
  profile: Pick<MemberProfile, "display_name" | "email"> | null | undefined,
  t?: TFunction
) {
  if (!profile) return t ? t("system.unknownPerson") : "Unbekannt";
  return profile.display_name?.trim() || profile.email.split("@")[0];
}

export function pigeonNameOf(profile: Pick<MemberProfile, "pigeon_name"> | null | undefined, t?: TFunction) {
  return profile?.pigeon_name?.trim() || (t ? t("system.defaultPigeonName") : DEFAULT_PIGEON_NAME);
}

export function avatarUrlOf(profile: Pick<MemberProfile, "avatar_url"> | null | undefined) {
  if (!profile?.avatar_url) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${AVATAR_BUCKET}/${profile.avatar_url}`;
}

export function accentOf(profile: Pick<MemberProfile, "accent_color"> | null | undefined) {
  return profile?.accent_color ?? DEFAULT_ACCENT;
}
