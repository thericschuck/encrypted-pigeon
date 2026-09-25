"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { resumeOutbox } from "@/lib/chat/outbox";

/**
 * Mounted once for the whole app (root layout): after a reload, messages
 * that were still on their way continue sending right away — on whatever
 * page the app opens, not only once that chat is visited again.
 */
export function OutboxResumer() {
  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        const userId = data.session?.user.id;
        if (userId) void resumeOutbox(userId);
      });
  }, []);

  return null;
}
