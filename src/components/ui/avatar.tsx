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
 * Profile picture on top of the person's initial on their accent color. The
 * initial is always there underneath, so a slow connection (picture still
 * loading) or a failed load never leaves an empty circle — the picture
 * fades in once it has actually loaded.
 */
export function Avatar({ profile, size = "md", srcOverride }: AvatarProps) {
  const src = srcOverride ?? avatarUrlOf(profile);
  const name = displayNameOf(profile);
  const sizeClass = SIZE_CLASSES[size];
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const showImage = !!src && src !== failedSrc;

  return (
    <span
      style={{ backgroundColor: accentOf(profile) }}
      className={`${sizeClass} relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold uppercase text-white`}
    >
      <span aria-hidden="true">{name.charAt(0)}</span>
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          // Cached images can finish before React attaches onLoad.
          ref={(el) => {
            if (el?.complete && el.naturalWidth > 0) setLoadedSrc(src);
          }}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
            loadedSrc === src ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </span>
  );
}
