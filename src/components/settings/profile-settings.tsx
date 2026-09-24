"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Database, ThemePreference } from "@/lib/supabase/types";
import {
  ACCENT_PRESETS,
  AVATAR_BUCKET,
  DEFAULT_ACCENT,
  DEFAULT_PIGEON_NAME,
  type MemberProfile,
} from "@/lib/profile";
import { applyThemeInBrowser } from "@/lib/theme";
import { applyAccentInBrowser } from "@/lib/accent";
import { looksLikeImage, processImage } from "@/lib/media/image";
import {
  isSessionExpiredError,
  redirectToLoginForExpiredSession,
} from "@/lib/auth/session-expiry";
import { Avatar } from "@/components/ui/avatar";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Hell" },
  { value: "dark", label: "Dunkel" },
];

// 2x the largest avatar size (lg = 80 CSS px) for sharp high-DPI screens.
const AVATAR_MAX_PX = 256;
// Names are saved this long after the last keystroke (or on blur).
const TEXT_SAVE_DELAY_MS = 700;

type ProfileUpdate = Database["pigeon"]["Tables"]["profiles"]["Update"];
type SaveState = { status: "idle" | "saving" | "saved" | "error"; message?: string };

interface ProfileSettingsProps {
  profile: MemberProfile;
}

/**
 * Every change saves itself: toggles and colors right away, the picture as
 * soon as it's picked, names shortly after typing stops.
 */
export function ProfileSettings({ profile }: ProfileSettingsProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [pigeonName, setPigeonName] = useState(profile.pigeon_name ?? "");
  const [accent, setAccent] = useState(profile.accent_color ?? DEFAULT_ACCENT);
  const [theme, setTheme] = useState<ThemePreference>(profile.theme);
  const [avatarPath, setAvatarPath] = useState(profile.avatar_url);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Saves run one after another, so a slow earlier one can never
  // overwrite a newer value.
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const pendingTextRef = useRef<ProfileUpdate>({});
  const textTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueuedTextRef = useRef({ display_name: profile.display_name, pigeon_name: profile.pigeon_name });

  useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  const reportError = useCallback((error: unknown) => {
    if (isSessionExpiredError(error)) {
      redirectToLoginForExpiredSession();
      return;
    }
    console.error("Saving profile failed:", error);
    setSave({
      status: "error",
      message:
        typeof navigator !== "undefined" && !navigator.onLine
          ? "Keine Internetverbindung — nicht gespeichert."
          : "Speichern fehlgeschlagen. Bitte erneut versuchen.",
    });
  }, []);

  const persist = useCallback(
    (update: ProfileUpdate): Promise<boolean> => {
      const run = async () => {
        setSave({ status: "saving" });
        try {
          const { error } = await createClient().from("profiles").update(update).eq("id", profile.id);
          if (error) throw error;
          setSave({ status: "saved", message: "Gespeichert ✓" });
          router.refresh();
          return true;
        } catch (error) {
          reportError(error);
          return false;
        }
      };
      const next = saveQueueRef.current.then(run);
      saveQueueRef.current = next;
      return next;
    },
    [profile.id, reportError, router]
  );

  const flushText = useCallback(() => {
    if (textTimerRef.current) clearTimeout(textTimerRef.current);
    textTimerRef.current = null;
    const update = pendingTextRef.current;
    pendingTextRef.current = {};
    if (Object.keys(update).length > 0) void persist(update);
  }, [persist]);

  // Leaving the page right after typing still saves the last change.
  useEffect(() => flushText, [flushText]);

  function queueText(field: "display_name" | "pigeon_name", raw: string) {
    const value = raw.trim() || null;
    if (lastQueuedTextRef.current[field] === value) {
      delete pendingTextRef.current[field];
    } else {
      pendingTextRef.current[field] = value;
      lastQueuedTextRef.current[field] = value;
    }
    if (textTimerRef.current) clearTimeout(textTimerRef.current);
    textTimerRef.current = setTimeout(flushText, TEXT_SAVE_DELAY_MS);
  }

  function handleThemeChange(next: ThemePreference) {
    if (next === theme) return;
    setTheme(next);
    applyThemeInBrowser(next);
    void persist({ theme: next });
  }

  function handleAccentChange(next: string) {
    if (next === accent) return;
    setAccent(next);
    const stored = next === DEFAULT_ACCENT ? null : next;
    applyAccentInBrowser(stored);
    void persist({ accent_color: stored });
  }

  async function replaceAvatar(nextPath: string | null) {
    const previous = avatarPath;
    const ok = await persist({ avatar_url: nextPath });
    if (!ok) return false;
    setAvatarPath(nextPath);
    // The old picture is no longer referenced anywhere — clean it up.
    if (previous && previous !== nextPath) {
      await createClient().storage.from(AVATAR_BUCKET).remove([previous]);
    }
    return true;
  }

  async function handleAvatarPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!looksLikeImage(file)) {
      setSave({ status: "error", message: "Bitte ein Bild auswählen." });
      return;
    }

    setAvatarPreview(URL.createObjectURL(file));
    setAvatarBusy(true);
    setSave({ status: "saving" });
    try {
      const resized = await processImage(file, { maxDimension: AVATAR_MAX_PX, quality: 0.9, square: true });
      // Random name per upload: the bucket is public, so the path must not
      // be guessable, and a new name also busts any cached old picture.
      const path = `${profile.id}/${crypto.randomUUID()}.${resized.extension}`;
      const { error } = await createClient()
        .storage.from(AVATAR_BUCKET)
        .upload(path, resized.blob, { contentType: resized.contentType, upsert: false });
      if (error) throw error;
      if (!(await replaceAvatar(path))) {
        await createClient().storage.from(AVATAR_BUCKET).remove([path]);
        setAvatarPreview(null);
      }
    } catch (error) {
      setAvatarPreview(null);
      if (error instanceof Error && /decode|empty image|canvas|encode/.test(error.message)) {
        setSave({ status: "error", message: "Dieses Bild kann nicht gelesen werden. Bitte ein anderes wählen." });
      } else {
        reportError(error);
      }
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleAvatarRemove() {
    setAvatarBusy(true);
    try {
      if (await replaceAvatar(null)) setAvatarPreview(null);
    } finally {
      setAvatarBusy(false);
    }
  }

  const previewProfile = {
    ...profile,
    avatar_url: avatarPath,
    display_name: displayName || null,
    accent_color: accent,
  };

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-neutral-200 p-4 dark:border-night-border dark:bg-night-surface">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Profil</h2>
        {save.status !== "idle" && (
          <span
            role={save.status === "error" ? "alert" : "status"}
            className={`text-xs ${
              save.status === "error"
                ? "text-red-600 dark:text-red-400"
                : save.status === "saving"
                  ? "text-neutral-500 dark:text-night-muted"
                  : "text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {save.status === "saving" ? "Speichert…" : save.message}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className={`relative ${avatarBusy ? "opacity-60" : ""}`}>
          <Avatar profile={previewProfile} size="lg" srcOverride={avatarPreview} />
          {avatarBusy && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
            </span>
          )}
        </div>
        <div className="flex flex-col items-start gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            onChange={handleAvatarPick}
            className="hidden"
          />
          <button
            type="button"
            disabled={avatarBusy}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-50"
          >
            {avatarPath ? "Bild ändern" : "Bild wählen"}
          </button>
          {avatarPath && (
            <button
              type="button"
              disabled={avatarBusy}
              onClick={() => void handleAvatarRemove()}
              className="text-xs text-neutral-500 underline disabled:opacity-50 dark:text-night-muted"
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
          onChange={(event) => {
            setDisplayName(event.target.value);
            queueText("display_name", event.target.value);
          }}
          onBlur={flushText}
          maxLength={40}
          placeholder={profile.email.split("@")[0]}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-base focus:border-accent focus:outline-none sm:text-sm dark:border-night-border"
        />
        <span className="text-xs text-neutral-500 dark:text-night-muted">So sehen dich die anderen.</span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Name deiner Brieftaube</span>
        <input
          value={pigeonName}
          onChange={(event) => {
            setPigeonName(event.target.value);
            queueText("pigeon_name", event.target.value);
          }}
          onBlur={flushText}
          maxLength={30}
          placeholder={DEFAULT_PIGEON_NAME}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-base focus:border-accent focus:outline-none sm:text-sm dark:border-night-border"
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
              onClick={() => handleAccentChange(preset.value)}
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
          <span className="rounded-2xl bg-bubble px-3 py-2 text-sm text-white">So sehen deine Nachrichten aus</span>
        </div>
        <span className="text-xs text-neutral-500 dark:text-night-muted">
          Gilt auch für Knöpfe und Schalter in der ganzen App.
        </span>
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
                theme === option.value ? "bg-accent text-on-accent" : "text-neutral-600 dark:text-night-muted"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
    </section>
  );
}
