"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";
import { MotionConfig, motion } from "framer-motion";
import type { ChatListItem } from "@/lib/chat/chat-overview";
import { displayNameOf, type MemberProfile } from "@/lib/profile";
import { startChat } from "@/app/actions/chats";
import { Avatar } from "@/components/ui/avatar";
import { AvatarScheduleDot } from "@/components/schedule/schedule-status";

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
                // The open chat is being read, whatever the count says.
                const unread = active ? 0 : chat.unreadCount;
                return (
                  <motion.li
                    key={chat.chatId}
                    layout="position"
                    transition={{ type: "spring", stiffness: 500, damping: 42 }}
                  >
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      aria-label={
                        unread > 0
                          ? `${displayNameOf(chat.partner)}, ${unread === 1 ? "1 ungelesene Nachricht" : `${unread} ungelesene Nachrichten`}`
                          : undefined
                      }
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                        active
                          ? "bg-neutral-100 dark:bg-night-raised"
                          : "hover:bg-neutral-50 dark:hover:bg-night-surface"
                      }`}
                    >
                      <span className="relative flex-shrink-0">
                        <Avatar profile={chat.partner} />
                        <AvatarScheduleDot schedule={chat.schedule} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={`truncate text-sm ${unread > 0 ? "font-semibold" : "font-medium"}`}>
                            {displayNameOf(chat.partner)}
                          </span>
                          {last && (
                            <span
                              className={`flex-shrink-0 text-[11px] ${
                                unread > 0
                                  ? "font-semibold text-[#b0532b] dark:text-night-accent"
                                  : "text-neutral-400 dark:text-night-muted"
                              }`}
                            >
                              {formatListTime(last.createdAt)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <p
                            className={`min-w-0 flex-1 truncate text-xs ${
                              unread > 0
                                ? "text-neutral-800 dark:text-night-text"
                                : "text-neutral-500 dark:text-night-muted"
                            }`}
                          >
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
                          {unread > 0 && (
                            <span
                              key={unread}
                              aria-hidden="true"
                              className="animate-fade-in flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#c1643a] px-1.5 text-[11px] font-semibold leading-none text-white dark:bg-night-accent dark:text-night-bg"
                            >
                              {unread > 99 ? "99+" : unread}
                            </span>
                          )}
                        </div>
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
