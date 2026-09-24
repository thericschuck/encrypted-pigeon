"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";
import { MotionConfig, motion } from "framer-motion";
import type { ChatListItem } from "@/lib/chat/chat-overview";
import { displayNameOf, type MemberProfile } from "@/lib/profile";
import { startChat } from "@/app/actions/chats";
import { Avatar } from "@/components/ui/avatar";

function formatListTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Gestern";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function StartChatButton({ member }: { member: MemberProfile }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-night-raised"
    >
      <Avatar profile={member} size="sm" />
      <span className="min-w-0 flex-1 truncate">{displayNameOf(member)}</span>
      <span className="text-xs text-neutral-400 dark:text-night-muted">
        {pending ? "Öffne…" : "Schreiben"}
      </span>
    </button>
  );
}

interface ChatListProps {
  chats: ChatListItem[];
  membersWithoutChat: MemberProfile[];
}

export function ChatList({ chats, membersWithoutChat }: ChatListProps) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-1">
        <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-night-muted">
          Chats
        </h2>
        {chats.length === 0 ? (
          <p className="px-3 py-2 text-sm text-neutral-400 dark:text-night-muted">
            Noch keine Chats. Starte unten eine Unterhaltung.
          </p>
        ) : (
          // A chat that gets a new message glides to the top instead of
          // jumping there. "position" only: rows never animate their size.
          <MotionConfig reducedMotion="user">
            <ul className="flex flex-col gap-0.5">
              {chats.map((chat) => {
                const href = `/chat/${chat.chatId}`;
                const active = pathname === href;
                const last = chat.lastMessage;
                return (
                  <motion.li
                    key={chat.chatId}
                    layout="position"
                    transition={{ type: "spring", stiffness: 500, damping: 42 }}
                  >
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                        active
                          ? "bg-neutral-100 dark:bg-night-raised"
                          : "hover:bg-neutral-50 dark:hover:bg-night-surface"
                      }`}
                    >
                      <Avatar profile={chat.partner} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">{displayNameOf(chat.partner)}</span>
                          {last && (
                            <span className="flex-shrink-0 text-[11px] text-neutral-400 dark:text-night-muted">
                              {formatListTime(last.createdAt)}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-neutral-500 dark:text-night-muted">
                          {chat.incomingLetterIds.length > 0 ? (
                            <span className="font-medium text-[#b0532b] dark:text-night-accent">
                              🕊️ Eine Taube ist zu dir unterwegs…
                            </span>
                          ) : last ? (
                            <>
                              {last.fromMe && "Du: "}
                              {last.kind === "pigeon" && "✉️ "}
                              {last.preview}
                            </>
                          ) : (
                            "Noch keine Nachrichten"
                          )}
                        </p>
                      </div>
                    </Link>
                  </motion.li>
                );
              })}
            </ul>
          </MotionConfig>
        )}
      </section>

      {membersWithoutChat.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-night-muted">
            Neue Unterhaltung
          </h2>
          <ul className="flex flex-col gap-0.5">
            {membersWithoutChat.map((member) => (
              <li key={member.id}>
                <form action={startChat}>
                  <input type="hidden" name="userId" value={member.id} />
                  <StartChatButton member={member} />
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
