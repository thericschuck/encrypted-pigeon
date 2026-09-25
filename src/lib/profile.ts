import type { Database } from "@/lib/supabase/types";

export type ProfileRow = Database["pigeon"]["Tables"]["profiles"]["Row"];

/** The profile fields the UI needs to render a person anywhere. */
export type MemberProfile = Pick<
  ProfileRow,
  "id" | "email" | "display_name" | "avatar_url" | "pigeon_name" | "accent_color" | "theme" | "timezone" | "schedule_public"
>;

export const MEMBER_PROFILE_COLUMNS =
  "id, email, display_name, avatar_url, pigeon_name, accent_color, theme, timezone, schedule_public";

export const AVATAR_BUCKET = "pigeon-avatars";

export const DEFAULT_ACCENT = "#171717";
export const DEFAULT_PIGEON_NAME = "Brieftaube";

// Every preset keeps white text readable (≥ 4.5:1) and works on both the
// light and the dark background, so no per-theme variants are needed.
export const ACCENT_PRESETS: { value: string; label: string }[] = [
  { value: "#171717", label: "Tinte" },
  { value: "#b0532b", label: "Terrakotta" },
  { value: "#3f6b3a", label: "Olive" },
  { value: "#1f5f8b", label: "Nachtblau" },
  { value: "#6b3fa0", label: "Pflaume" },
  { value: "#a3324f", label: "Weinrot" },
];

export function displayNameOf(profile: Pick<MemberProfile, "display_name" | "email"> | null | undefined) {
  if (!profile) return "Unbekannt";
  return profile.display_name?.trim() || profile.email.split("@")[0];
}

export function pigeonNameOf(profile: Pick<MemberProfile, "pigeon_name"> | null | undefined) {
  return profile?.pigeon_name?.trim() || DEFAULT_PIGEON_NAME;
}

export function avatarUrlOf(profile: Pick<MemberProfile, "avatar_url"> | null | undefined) {
  if (!profile?.avatar_url) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${AVATAR_BUCKET}/${profile.avatar_url}`;
}

export function accentOf(profile: Pick<MemberProfile, "accent_color"> | null | undefined) {
  return profile?.accent_color ?? DEFAULT_ACCENT;
}
