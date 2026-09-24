"use client";

import { useState } from "react";
import { accentOf, avatarUrlOf, displayNameOf, type MemberProfile } from "@/lib/profile";

interface AvatarProps {
  profile: MemberProfile | null | undefined;
  size?: "sm" | "md" | "lg";
  /** Local preview (e.g. a just-picked file) instead of the stored avatar. */
  srcOverride?: string | null;
}

const SIZE_CLASSES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-20 w-20 text-2xl",
};

/**
 * Profile picture, or the person's initial on their accent color — also
 * when the picture fails to load (deleted file, network), instead of a
 * broken-image icon.
 */
export function Avatar({ profile, size = "md", srcOverride }: AvatarProps) {
  const src = srcOverride ?? avatarUrlOf(profile);
  const name = displayNameOf(profile);
  const sizeClass = SIZE_CLASSES[size];
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && src !== failedSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailedSrc(src)}
        className={`${sizeClass} flex-shrink-0 rounded-full object-cover`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: accentOf(profile) }}
      className={`${sizeClass} flex flex-shrink-0 items-center justify-center rounded-full font-semibold uppercase text-white`}
    >
      {name.charAt(0)}
    </span>
  );
}
