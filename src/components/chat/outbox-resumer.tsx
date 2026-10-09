"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { resumeOutbox } from "@/lib/chat/outbox";
import { setChatTranslator } from "@/lib/chat/chat-translator";
import { useT } from "@/lib/i18n/client";

/**
 * Mounted once for the whole app (root layout): after a reload, messages
 * that were still on their way continue sending right away — on whatever
 * page the app opens, not only once that chat is visited again.
 */
export function OutboxResumer() {
  const t = useT();
  // Before the resume effect below, so a resumed send already errors in the right language.
  setChatTranslator(t);

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
