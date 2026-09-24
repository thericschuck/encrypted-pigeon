"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import imageCompression from "browser-image-compression";
import { createClient } from "@/lib/supabase/client";
import type { ThemePreference } from "@/lib/supabase/types";
import {
  ACCENT_PRESETS,
  AVATAR_BUCKET,
  DEFAULT_ACCENT,
  DEFAULT_PIGEON_NAME,
  type MemberProfile,
} from "@/lib/profile";
import { applyThemeInBrowser } from "@/lib/theme";
import {
  isSessionExpiredError,
  redirectToLoginForExpiredSession,
} from "@/lib/auth/session-expiry";
import { Avatar } from "@/components/ui/avatar";
import { IMAGE_COMPRESSION_LIB_URL } from "@/lib/image-compression";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Hell" },
  { value: "dark", label: "Dunkel" },
];

const AVATAR_MAX_PX = 256;

interface ProfileSettingsProps {
  profile: MemberProfile;
}

type SaveState = { status: "idle" | "saving" | "saved" | "error"; message?: string };

export function ProfileSettings({ profile }: ProfileSettingsProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [pigeonName, setPigeonName] = useState(profile.pigeon_name ?? "");
  const [accent, setAccent] = useState(profile.accent_color ?? DEFAULT_ACCENT);
  const [theme, setTheme] = useState<ThemePreference>(profile.theme);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  function handleThemeChange(next: ThemePreference) {
    setTheme(next);
    // Preview right away; persisted with "Speichern".
    applyThemeInBrowser(next);
  }

  function handleAvatarPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    setAvatarFile(file);
    setRemoveAvatar(false);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function uploadAvatar(): Promise<string> {
    const supabase = createClient();
    const resized = await imageCompression(avatarFile!, {
      maxWidthOrHeight: AVATAR_MAX_PX,
      maxSizeMB: 0.3,
      fileType: "image/webp",
      useWebWorker: true,
      libURL: IMAGE_COMPRESSION_LIB_URL,
    });
    // Random name per upload: the bucket is public, so the path must not
    // be guessable, and a new name also busts any cached old picture.
    const path = `${profile.id}/${crypto.randomUUID()}.webp`;
    const { error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, resized, { contentType: "image/webp", upsert: false });
    if (error) throw error;
    return path;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedName = displayName.trim();
    const trimmedPigeon = pigeonName.trim();
    if (trimmedName.length > 40 || trimmedPigeon.length > 30) {
      setSave({ status: "error", message: "Name max. 40, Taubenname max. 30 Zeichen." });
      return;
    }

    setSave({ status: "saving" });
    const supabase = createClient();
    const previousAvatar = profile.avatar_url;

    try {
      let avatarPath: string | null | undefined;
      if (avatarFile) avatarPath = await uploadAvatar();
      else if (removeAvatar) avatarPath = null;

      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: trimmedName || null,
          pigeon_name: trimmedPigeon || null,
          accent_color: accent === DEFAULT_ACCENT ? null : accent,
          theme,
          ...(avatarPath !== undefined ? { avatar_url: avatarPath } : {}),
        })
        .eq("id", profile.id);
      if (error) throw error;

      // Old picture is no longer referenced anywhere — clean it up.
      if (avatarPath !== undefined && previousAvatar && previousAvatar !== avatarPath) {
        await supabase.storage.from(AVATAR_BUCKET).remove([previousAvatar]);
      }

      applyThemeInBrowser(theme);
      setAvatarFile(null);
      setSave({ status: "saved", message: "Gespeichert ✓" });
      router.refresh();
    } catch (error) {
      if (isSessionExpiredError(error)) {
        redirectToLoginForExpiredSession();
        return;
      }
      console.error("Saving profile failed:", error);
      setSave({
        status: "error",
        message:
          typeof navigator !== "undefined" && !navigator.onLine
            ? "Keine Internetverbindung. Bitte später erneut versuchen."
            : "Speichern fehlgeschlagen. Bitte erneut versuchen.",
      });
    }
  }

  const shownAvatarProfile = removeAvatar ? { ...profile, avatar_url: null } : profile;
  const previewProfile = { ...shownAvatarProfile, display_name: displayName || null, accent_color: accent };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5 rounded-xl border border-neutral-200 p-4 dark:border-night-border dark:bg-night-surface"
    >
      <h2 className="text-sm font-semibold">Profil</h2>

      <div className="flex items-center gap-4">
        <Avatar profile={previewProfile} size="lg" srcOverride={avatarPreview} />
        <div className="flex flex-col items-start gap-1.5">
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarPick} className="hidden" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium dark:border-night-border"
          >
            Bild wählen
          </button>
          {(profile.avatar_url || avatarFile) && !removeAvatar && (
            <button
              type="button"
              onClick={() => {
                setAvatarFile(null);
                setAvatarPreview(null);
                setRemoveAvatar(true);
              }}
              className="text-xs text-neutral-500 underline dark:text-night-muted"
            >
              Bild entfernen
            </button>
          )}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Anzeigename</span>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={40}
          placeholder={profile.email.split("@")[0]}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-base sm:text-sm dark:border-night-border"
        />
        <span className="text-xs text-neutral-500 dark:text-night-muted">So sehen dich die anderen.</span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Name deiner Brieftaube</span>
        <input
          value={pigeonName}
          onChange={(event) => setPigeonName(event.target.value)}
          maxLength={30}
          placeholder={DEFAULT_PIGEON_NAME}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-base sm:text-sm dark:border-night-border"
        />
        <span className="text-xs text-neutral-500 dark:text-night-muted">
          Erscheint auf der Flugkarte und in den Benachrichtigungen.
        </span>
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-2 font-medium">Akzentfarbe</legend>
        <div className="flex flex-wrap gap-2">
          {ACCENT_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => setAccent(preset.value)}
              aria-label={preset.label}
              aria-pressed={accent === preset.value}
              title={preset.label}
              style={{ backgroundColor: preset.value }}
              className={`h-9 w-9 rounded-full ring-offset-2 ring-offset-white transition dark:ring-offset-night-surface ${
                accent === preset.value ? "ring-2 ring-neutral-400 dark:ring-night-muted" : ""
              }`}
            />
          ))}
        </div>
        <div className="mt-1 flex">
          <span style={{ backgroundColor: accent }} className="rounded-2xl px-3 py-2 text-sm text-white">
            So sehen deine Nachrichten aus
          </span>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-2 font-medium">Darstellung</legend>
        <div className="inline-flex w-fit rounded-full border border-neutral-300 p-0.5 dark:border-night-border">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleThemeChange(option.value)}
              aria-pressed={theme === option.value}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                theme === option.value
                  ? "bg-neutral-900 text-white dark:bg-night-accent dark:text-night-bg"
                  : "text-neutral-600 dark:text-night-muted"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={save.status === "saving"}
          className="rounded-full bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-night-accent dark:text-night-bg"
        >
          {save.status === "saving" ? "Speichert…" : "Speichern"}
        </button>
        {save.message && (
          <span
            role={save.status === "error" ? "alert" : "status"}
            className={`text-xs ${
              save.status === "error" ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {save.message}
          </span>
        )}
      </div>
    </form>
  );
}
