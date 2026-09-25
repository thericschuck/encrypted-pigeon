"use client";

import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `intervalMs` and when the app comes
 * back to the foreground. null during the server render and hydration:
 * "now" (and the viewer's zone) only exist in the browser, so anything
 * time-dependent renders after mount instead of mismatching.
 */
export function useNow(intervalMs = 30_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const interval = setInterval(tick, intervalMs);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [intervalMs]);

  return now;
}
