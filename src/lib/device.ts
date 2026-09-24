// Shared by the PWA install prompt and the push-permission prompt — both
// need to tell "iOS, not installed yet" apart from every other case.

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const isIOSUserAgent = /iPad|iPhone|iPod/.test(navigator.userAgent);
  // iPadOS 13+ reports as "MacIntel" in the UA string; touch support is the
  // only reliable way left to tell it apart from an actual Mac.
  const isIPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return isIOSUserAgent || isIPadOS;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
